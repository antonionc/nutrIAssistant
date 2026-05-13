import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { AppContext } from '../env'
import { edgeCache } from '../middleware/cache'
import { parseOrThrow } from '../lib/validate'

export const edamamRoute = new Hono<AppContext>()

const ONE_HOUR = 3600
const SIX_HOURS = 6 * 3600
const API_BASE = 'https://api.edamam.com/api/recipes/v2'

// ── Schemas ─────────────────────────────────────────────────────────────────

const searchSchema = z.object({
  q: z.string().min(1).max(200),
  cuisineType: z.string().max(50).optional(),
  mealType: z.string().max(50).optional(),
  dishType: z.string().max(50).optional(),
  diet: z.string().max(50).optional(),
  health: z.string().max(50).optional(),
  imageSize: z.enum(['THUMBNAIL', 'SMALL', 'REGULAR', 'LARGE']).optional(),
  random: z.enum(['true', 'false']).optional(),
})

// Edamam recipe IDs are 32-char hex strings prefixed with "recipe_".
const recipeIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_]{1,100}$/, 'invalid edamam recipe id')

// ── Helpers ─────────────────────────────────────────────────────────────────

function authParams(env: AppContext['Bindings']): URLSearchParams {
  return new URLSearchParams({
    type: 'public',
    app_id: env.EDAMAM_APP_ID,
    app_key: env.EDAMAM_APP_KEY,
  })
}

function edamamHeaders(env: AppContext['Bindings']): HeadersInit {
  // Edamam Recipe Search v2 requires Edamam-Account-User on every request.
  // It's how the free tier meters usage per account.
  return {
    'Edamam-Account-User': env.EDAMAM_ACCOUNT_USER,
    Accept: 'application/json',
  }
}

async function passUpstreamError(resp: Response, label: string): Promise<never> {
  // Surface a usable error code without leaking response bodies.
  const code =
    resp.status === 401 || resp.status === 403
      ? 'edamam_auth_error'
      : resp.status === 429
        ? 'edamam_rate_limited'
        : 'edamam_upstream_error'

  throw new HTTPException(502, {
    message: `${label}_${resp.status}`,
    cause: code,
  })
}

const EDAMAM_API_HOSTS = new Set(['api.edamam.com'])
const STRIPPED_QS_KEYS = new Set(['app_id', 'app_key', 'type'])

/**
 * Rewrites a single Edamam API URL to its BFF equivalent, stripping
 * credentials. Returns null if the input is not an Edamam API URL.
 */
function rewriteOne(url: string, origin: string): string | null {
  try {
    const u = new URL(url)
    if (!EDAMAM_API_HOSTS.has(u.hostname)) return null
    if (!u.pathname.startsWith('/api/recipes/v2')) return null

    // /api/recipes/v2          → /v1/edamam/recipes/search
    // /api/recipes/v2/<id>     → /v1/edamam/recipes/<id>
    const suffix = u.pathname.slice('/api/recipes/v2'.length)
    const safePath = suffix === '' || suffix === '/'
      ? '/v1/edamam/recipes/search'
      : `/v1/edamam/recipes${suffix}`

    const safe = new URL(safePath, origin)
    u.searchParams.forEach((value, key) => {
      if (!STRIPPED_QS_KEYS.has(key)) safe.searchParams.set(key, value)
    })
    return safe.toString()
  } catch {
    return null
  }
}

/**
 * Edamam's response embeds the raw `app_id` and `app_key` in MANY URLs:
 *   - top-level `_links.next.href`           (pagination)
 *   - each `hits[i]._links.self.href`        (per-recipe self link)
 *   - potentially others Edamam adds in the future
 *
 * Walk the entire response and rewrite any value that looks like an Edamam
 * API URL — point it at the BFF and strip the credentials. Other strings
 * (recipe URLs, image URLs, ingredient names) are left untouched.
 *
 * Conservatively typed as `unknown` end-to-end so we don't accidentally
 * mutate something we shouldn't.
 */
function rewriteEdamamLinks(node: unknown, origin: string): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => rewriteEdamamLinks(item, origin))
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') {
        const rewritten = rewriteOne(value, origin)
        out[key] = rewritten ?? value
      } else {
        out[key] = rewriteEdamamLinks(value, origin)
      }
    }
    return out
  }
  return node
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /v1/edamam/recipes/search?q=paella&cuisineType=mediterranean&...
 *
 * Mirrors `GET /api/recipes/v2?type=public&q=...` with the Edamam-Account-User
 * header injected server-side. Returns the upstream JSON verbatim — the client
 * mapper consumes the `hits[].recipe` shape directly.
 *
 * Optional filters mirror Edamam's facets: cuisineType, mealType, dishType,
 * diet (balanced, high-protein, ...), health (gluten-free, vegan, ...).
 */
edamamRoute.get('/recipes/search', edgeCache(ONE_HOUR), async (c) => {
  const params = parseOrThrow(searchSchema, {
    q: c.req.query('q'),
    cuisineType: c.req.query('cuisineType'),
    mealType: c.req.query('mealType'),
    dishType: c.req.query('dishType'),
    diet: c.req.query('diet'),
    health: c.req.query('health'),
    imageSize: c.req.query('imageSize'),
    random: c.req.query('random'),
  })

  const qs = authParams(c.env)
  qs.set('q', params.q)
  if (params.cuisineType) qs.set('cuisineType', params.cuisineType)
  if (params.mealType) qs.set('mealType', params.mealType)
  if (params.dishType) qs.set('dishType', params.dishType)
  if (params.diet) qs.set('diet', params.diet)
  if (params.health) qs.set('health', params.health)
  if (params.imageSize) qs.set('imageSize', params.imageSize)
  if (params.random) qs.set('random', params.random)

  const resp = await fetch(`${API_BASE}?${qs}`, { headers: edamamHeaders(c.env) })
  if (!resp.ok) await passUpstreamError(resp, 'edamam_search')

  const body = await resp.json()
  const origin = new URL(c.req.url).origin
  return c.json(rewriteEdamamLinks(body, origin))
})

/**
 * GET /v1/edamam/recipes/:id
 *
 * Single recipe detail by Edamam's internal id (the suffix after `recipe_` in
 * the URI, e.g. `recipe_1c2d3e...`). Endpoint shape: `/api/recipes/v2/{id}`.
 */
edamamRoute.get('/recipes/:id', edgeCache(SIX_HOURS), async (c) => {
  const recipeId = parseOrThrow(recipeIdSchema, c.req.param('id'))

  const qs = authParams(c.env)
  const resp = await fetch(`${API_BASE}/${recipeId}?${qs}`, {
    headers: edamamHeaders(c.env),
  })
  if (!resp.ok) await passUpstreamError(resp, 'edamam_detail')

  const body = await resp.json()
  const origin = new URL(c.req.url).origin
  return c.json(rewriteEdamamLinks(body, origin))
})
