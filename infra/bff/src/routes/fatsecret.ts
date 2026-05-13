import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { AppContext } from '../env'
import { edgeCache } from '../middleware/cache'
import { parseOrThrow, recipeIdSchema } from '../lib/validate'
import { getFatSecretToken } from '../lib/fatsecretToken'

export const fatsecretRoute = new Hono<AppContext>()

const ONE_HOUR = 3600
const SIX_HOURS = 6 * 3600
const API_BASE = 'https://platform.fatsecret.com/rest'

const searchSchema = z.object({
  q: z.string().min(1).max(200),
  max_results: z.string().regex(/^\d+$/).optional(),
  must_have_images: z.enum(['true', 'false']).optional(),
})

/**
 * GET /v1/fatsecret/recipes/search?q=mediterranean&max_results=50
 *
 * Searches the FatSecret recipe catalog. Returns the upstream JSON shape
 * `{ recipes: { recipe: FSRecipeStubRaw | FSRecipeStubRaw[] } }` so the
 * client's `toArray` helper keeps working.
 */
fatsecretRoute.get('/recipes/search', edgeCache(ONE_HOUR), async (c) => {
  const { q, max_results, must_have_images } = parseOrThrow(searchSchema, {
    q: c.req.query('q'),
    max_results: c.req.query('max_results'),
    must_have_images: c.req.query('must_have_images'),
  })

  const token = await getFatSecretToken(c.env)
  const params = new URLSearchParams({
    method: 'recipes.search.v3',
    search_expression: q,
    max_results: max_results ?? '50',
    must_have_images: must_have_images ?? 'true',
    format: 'json',
  })

  const resp = await fetch(`${API_BASE}/recipes/search/v3?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new HTTPException(502, {
      message: `fatsecret_upstream_${resp.status}`,
      cause: 'fatsecret_upstream_error',
    })
  }

  return c.json(await resp.json())
})

/**
 * GET /v1/fatsecret/recipes/:id
 *
 * Returns full recipe detail. Caches longer than search because details
 * change rarely.
 */
fatsecretRoute.get('/recipes/:id', edgeCache(SIX_HOURS), async (c) => {
  const recipeId = parseOrThrow(recipeIdSchema, c.req.param('id'))

  const token = await getFatSecretToken(c.env)
  const params = new URLSearchParams({
    method: 'recipe.get.v2',
    recipe_id: recipeId,
    format: 'json',
  })

  const resp = await fetch(`${API_BASE}/recipe/v2?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!resp.ok) {
    throw new HTTPException(502, {
      message: `fatsecret_upstream_${resp.status}`,
      cause: 'fatsecret_upstream_error',
    })
  }

  return c.json(await resp.json())
})
