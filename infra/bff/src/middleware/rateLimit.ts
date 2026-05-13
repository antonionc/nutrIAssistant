import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppContext } from '../env'

/**
 * Per-IP fixed-window rate limit backed by KV.
 *
 * Window: 60 seconds.
 * Limit:  RATE_LIMIT_PER_MINUTE (from wrangler.toml vars).
 *
 * KV is eventually consistent, so this is best-effort — it will let a few
 * extra requests through under bursty conditions, but cannot be tricked
 * into orders-of-magnitude overshoot. Good enough to protect FatSecret /
 * Spoonacular quotas from accidental abuse.
 *
 * For stronger guarantees, swap for the platform-native RateLimit binding
 * (Workers Paid plan, $5/mo) — the interface is identical.
 */
export const rateLimit: MiddlewareHandler<AppContext> = async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const window = Math.floor(Date.now() / 60_000)
  const key = `rl:${ip}:${window}`

  const limit = parseInt(c.env.RATE_LIMIT_PER_MINUTE, 10) || 60

  const raw = await c.env.RATE_LIMIT_KV.get(key)
  const count = raw ? parseInt(raw, 10) : 0

  if (count >= limit) {
    throw new HTTPException(429, {
      message: 'rate_limit_exceeded',
      cause: 'rate_limit_exceeded',
    })
  }

  // Fire-and-forget increment with 90s TTL (window + grace).
  c.executionCtx.waitUntil(
    c.env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: 90 })
  )

  await next()
}
