import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppContext } from '../env'
import { edgeCache } from '../middleware/cache'
import { barcodeSchema, parseOrThrow } from '../lib/validate'

export const offRoute = new Hono<AppContext>()

const ONE_DAY = 24 * 3600

/**
 * GET /v1/off/product/:barcode
 *
 * Proxies world.openfoodfacts.org. OFF has no auth, but proxying still
 * yields three wins: (1) edge cache reduces upstream load, (2) clients
 * never need to know the real OFF URL, (3) we can swap to a self-hosted
 * mirror later without app updates.
 *
 * Returns the OFF v2 product response verbatim so the existing client
 * mapper (`mapNutriments`, `parseNutriScore`) keeps working unchanged.
 */
offRoute.get('/product/:barcode', edgeCache(ONE_DAY), async (c) => {
  const barcode = parseOrThrow(barcodeSchema, c.req.param('barcode'))

  // Use the `.net` alias instead of `.org`. The .org domain is fronted by
  // Cloudflare, which causes persistent HTTP 525 (SSL handshake failed)
  // errors on Workers↔Cloudflare zone-to-zone routing. The .net alias
  // resolves to the same backend without the CF front, sidestepping the
  // routing pathology entirely.
  const upstream = `https://world.openfoodfacts.net/api/v2/product/${barcode}.json`

  const resp = await fetch(upstream, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NutrIAssistantBFF/0.1; +https://nutriassistant.org)',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    cf: { cacheTtl: 86400, cacheEverything: true },
  })

  if (resp.status === 404) {
    return c.json({ status: 0, product: null }, 200)
  }

  if (!resp.ok) {
    throw new HTTPException(502, {
      message: `off_upstream_${resp.status}`,
      cause: 'off_upstream_error',
    })
  }

  const body = await resp.json()
  return c.json(body)
})
