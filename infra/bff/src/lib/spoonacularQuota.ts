import type { Env } from '../env'
import { HTTPException } from 'hono/http-exception'

/**
 * Global daily call counter for Spoonacular, shared across all clients.
 *
 * The free Spoonacular plan grants 150 points/day; the paid plan goes up to
 * 10k points/day. The counter is global because the API key is global —
 * tracking per-device (as the legacy client code did) was meaningless.
 *
 * Key format: `sp:quota:YYYY-MM-DD` so it auto-rolls at UTC midnight.
 * TTL is 36h to cover any timezone skew without leaving stale entries.
 */

function todayKey(): string {
  return `sp:quota:${new Date().toISOString().slice(0, 10)}`
}

export async function getSpoonacularUsed(env: Env): Promise<number> {
  const raw = await env.QUOTA_KV.get(todayKey())
  return raw ? parseInt(raw, 10) : 0
}

/**
 * Atomically check + increment. Raises 429 with `quota_exhausted` if we
 * would overshoot. Note: KV is eventually consistent; under high concurrency
 * a few extra calls can slip through. The buffer in SPOONACULAR_DAILY_LIMIT
 * should account for this.
 */
export async function consumeSpoonacularQuota(env: Env, cost = 1): Promise<void> {
  const limit = parseInt(env.SPOONACULAR_DAILY_LIMIT, 10) || 10_000
  const used = await getSpoonacularUsed(env)

  if (used + cost > limit) {
    throw new HTTPException(429, {
      message: 'spoonacular_quota_exhausted',
      cause: 'quota_exhausted',
    })
  }

  await env.QUOTA_KV.put(todayKey(), String(used + cost), {
    expirationTtl: 36 * 3600,
  })
}
