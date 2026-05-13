import type { MiddlewareHandler } from 'hono'
import type { AppContext } from '../env'

/**
 * Edge-cache GET responses for the requested TTL using Cloudflare's
 * default cache. Keyed by full URL (including query string).
 *
 * Only caches 200 responses with JSON bodies. 404 / 5xx pass through
 * untouched so upstream errors do not poison the cache.
 */
export function edgeCache(ttlSeconds: number): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    if (c.req.method !== 'GET') return next()

    const cache = caches.default
    const cacheKey = new Request(c.req.url, c.req.raw)

    const hit = await cache.match(cacheKey)
    if (hit) {
      const cloned = new Response(hit.body, hit)
      cloned.headers.set('x-cache', 'HIT')
      return cloned
    }

    await next()
    const res = c.res

    if (res.status === 200 && res.headers.get('content-type')?.includes('application/json')) {
      const cloned = res.clone()
      cloned.headers.set('cache-control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`)
      cloned.headers.set('x-cache', 'MISS')
      c.executionCtx.waitUntil(cache.put(cacheKey, cloned.clone()))
      c.res = cloned
    }
  }
}
