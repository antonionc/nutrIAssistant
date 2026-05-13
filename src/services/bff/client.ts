/**
 * Shared client for talking to the NutrIAssistant BFF
 * (https://api.nutriassistant.org). One place to evolve retry/timeout/
 * telemetry instead of duplicating the same fetch wrapper across every
 * provider service.
 *
 * Used by:
 *   - src/services/edamam.ts
 *   - src/services/spoonacular.ts
 *   - src/services/openFoodFacts.ts
 */

export const BFF_BASE =
  process.env.EXPO_PUBLIC_BFF_BASE_URL ?? 'https://api.nutriassistant.org'

/** Non-2xx (and non-429) response from the BFF. */
export class BffError extends Error {
  constructor(
    public readonly service: string,
    public readonly path: string,
    public readonly status: number,
    public readonly bodySnippet: string = '',
  ) {
    super(`[${service} BFF] ${path} returned ${status}`)
    this.name = 'BffError'
  }
}

/**
 * 429 specifically — the upstream provider's global daily quota (tracked
 * by the BFF) is exhausted. Surfaced as a distinct error so callers can
 * show a meaningful UI message and invalidate any local quota cache.
 */
export class BffQuotaExhaustedError extends BffError {
  constructor(service: string, path: string) {
    super(service, path, 429, 'quota_exhausted')
    this.name = 'BffQuotaExhaustedError'
  }
}

export interface BffGetOptions {
  /** Logging / error-tag identifier (e.g. 'Edamam'). */
  service: string
  /** BFF path including leading slash (e.g. '/v1/edamam/recipes/search'). */
  path: string
  /** Query params; values are URL-encoded automatically. */
  params?: Record<string, string>
  /**
   * Optional side-effect to run before throwing on a 429 response.
   * Spoonacular uses this to invalidate its local quota cache so the
   * UI reflects the global counter immediately.
   */
  onQuotaExhausted?: () => void | Promise<void>
}

/**
 * GET a BFF endpoint and parse JSON. Throws BffQuotaExhaustedError on 429
 * and BffError on any other non-2xx. Network errors propagate from fetch.
 */
export async function bffGet<T>(opts: BffGetOptions): Promise<T> {
  const url = new URL(`${BFF_BASE}${opts.path}`)
  for (const [key, value] of Object.entries(opts.params ?? {})) {
    url.searchParams.set(key, value)
  }

  const resp = await fetch(url.toString())

  if (resp.status === 429) {
    await opts.onQuotaExhausted?.()
    throw new BffQuotaExhaustedError(opts.service, opts.path)
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new BffError(opts.service, opts.path, resp.status, text.slice(0, 200))
  }

  return resp.json() as Promise<T>
}
