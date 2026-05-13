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

  const upstream = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`
  const resp = await fetch(upstream, {
    headers: { 'User-Agent': 'NutrIAssistant-BFF/0.1 (https://nutriassistant.org)' },
  })

  if (resp.status === 404) {
    return c.json({ status: 0, product: null }, 200)
  }

  if (!resp.ok) {
    throw new HTTPException(502, { message: 'upstream_error', cause: 'off_upstream_error' })
  }

  const body = await resp.json()
  return c.json(body)
})
