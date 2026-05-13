import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { AppContext } from '../env'
import { edgeCache } from '../middleware/cache'
import { parseOrThrow, positiveIntStringSchema } from '../lib/validate'
import { consumeSpoonacularQuota, getSpoonacularUsed } from '../lib/spoonacularQuota'

export const spoonacularRoute = new Hono<AppContext>()

const ONE_HOUR = 3600
const SIX_HOURS = 6 * 3600
const API_BASE = 'https://api.spoonacular.com'

const complexSearchSchema = z.object({
  cuisine: z.string().min(1).max(50),
  number: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
  sort: z.enum(['popularity', 'healthiness', 'time', 'random']).optional(),
})

/**
 * GET /v1/spoonacular/quota
 *
 * Reports today's usage so the app can show a quota indicator (and the
 * BFF operator can monitor without diving into KV). Free + cheap to call.
 */
spoonacularRoute.get('/quota', async (c) => {
  const used = await getSpoonacularUsed(c.env)
  const limit = parseInt(c.env.SPOONACULAR_DAILY_LIMIT, 10) || 10_000
  return c.json({
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt: new Date(
      new Date().toISOString().slice(0, 10) + 'T23:59:59Z',
    ).toISOString(),
  })
})

/**
 * GET /v1/spoonacular/complex-search?cuisine=italian&number=100&offset=0&sort=popularity
 *
 * Mirrors `/recipes/complexSearch`. Consumes 1 quota point on a non-cached
 * hit; cached hits cost 0.
 */
spoonacularRoute.get('/complex-search', edgeCache(ONE_HOUR), async (c) => {
  const params = parseOrThrow(complexSearchSchema, {
    cuisine: c.req.query('cuisine'),
    number: c.req.query('number'),
    offset: c.req.query('offset'),
    sort: c.req.query('sort'),
  })

  // Reserve quota before calling upstream so concurrent requests respect the cap.
  await consumeSpoonacularQuota(c.env, 1)

  const qs = new URLSearchParams({
    cuisine: params.cuisine,
    number: params.number ?? '100',
    offset: params.offset ?? '0',
    sort: params.sort ?? 'popularity',
    apiKey: c.env.SPOONACULAR_API_KEY,
  })

  const resp = await fetch(`${API_BASE}/recipes/complexSearch?${qs}`)

  if (!resp.ok) {
    throw new HTTPException(502, {
      message: `spoonacular_upstream_${resp.status}`,
      cause: 'spoonacular_upstream_error',
    })
  }

  return c.json(await resp.json())
})

/**
 * GET /v1/spoonacular/recipes/:id?includeNutrition=true
 *
 * Recipe detail. Consumes 1 quota point on a non-cached hit.
 */
spoonacularRoute.get('/recipes/:id', edgeCache(SIX_HOURS), async (c) => {
  const recipeId = parseOrThrow(positiveIntStringSchema, c.req.param('id'))
  const includeNutrition = c.req.query('includeNutrition') === 'true' ? 'true' : 'false'

  await consumeSpoonacularQuota(c.env, 1)

  const qs = new URLSearchParams({
    includeNutrition,
    apiKey: c.env.SPOONACULAR_API_KEY,
  })

  const resp = await fetch(`${API_BASE}/recipes/${recipeId}/information?${qs}`)

  if (!resp.ok) {
    throw new HTTPException(502, {
      message: `spoonacular_upstream_${resp.status}`,
      cause: 'spoonacular_upstream_error',
    })
  }

  return c.json(await resp.json())
})
