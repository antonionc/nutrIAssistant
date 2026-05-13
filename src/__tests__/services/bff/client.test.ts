// Tests for the shared BFF client. fetch is mocked per-test so we can
// verify URL construction, error envelopes, and quota-exhaustion handling
// without touching the real network.

import { bffGet, BffError, BffQuotaExhaustedError, BFF_BASE } from '../../../services/bff/client'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

function mockFetchOnce(body: unknown, init: { status?: number; ok?: boolean; text?: string } = {}) {
  const status = init.status ?? 200
  const ok = init.ok ?? (status >= 200 && status < 300)
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
    text: async () => init.text ?? JSON.stringify(body),
  })
}

describe('bffGet', () => {
  it('constructs the URL from BFF_BASE + path + params', async () => {
    mockFetchOnce({ ok: true })
    await bffGet({
      service: 'Edamam',
      path: '/v1/edamam/recipes/search',
      params: { q: 'paella', cuisineType: 'mediterranean' },
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const calledWith = (global.fetch as jest.Mock).mock.calls[0][0] as string
    const parsed = new URL(calledWith)
    expect(parsed.origin + parsed.pathname).toBe(`${BFF_BASE}/v1/edamam/recipes/search`)
    expect(parsed.searchParams.get('q')).toBe('paella')
    expect(parsed.searchParams.get('cuisineType')).toBe('mediterranean')
  })

  it('returns parsed JSON on 200', async () => {
    mockFetchOnce({ count: 42, hits: [] })
    const data = await bffGet<{ count: number }>({ service: 'Edamam', path: '/v1/edamam/recipes/search' })
    expect(data.count).toBe(42)
  })

  it('omits the query string when no params are provided', async () => {
    mockFetchOnce({ ok: true })
    await bffGet({ service: 'OpenFoodFacts', path: '/v1/off/product/3017620422003' })
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string
    expect(url).toBe(`${BFF_BASE}/v1/off/product/3017620422003`)
  })

  it('encodes special characters in params', async () => {
    mockFetchOnce({ ok: true })
    await bffGet({
      service: 'Edamam',
      path: '/v1/edamam/recipes/search',
      params: { q: 'chicken & rice', diet: 'low-fat' },
    })
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string
    expect(url).toContain('q=chicken+%26+rice')
    expect(url).toContain('diet=low-fat')
  })

  it('throws BffError on a generic non-2xx', async () => {
    mockFetchOnce({ error: 'upstream_error' }, { status: 502, ok: false, text: '{"error":"upstream_error"}' })
    await expect(
      bffGet({ service: 'Edamam', path: '/v1/edamam/recipes/search' })
    ).rejects.toThrow(BffError)
  })

  it('attaches service + path + status to BffError', async () => {
    mockFetchOnce({}, { status: 503, ok: false })
    try {
      await bffGet({ service: 'Spoonacular', path: '/v1/spoonacular/complex-search' })
      fail('expected BffError')
    } catch (err) {
      expect(err).toBeInstanceOf(BffError)
      const bff = err as BffError
      expect(bff.service).toBe('Spoonacular')
      expect(bff.path).toBe('/v1/spoonacular/complex-search')
      expect(bff.status).toBe(503)
    }
  })

  it('throws BffQuotaExhaustedError on 429', async () => {
    mockFetchOnce({}, { status: 429, ok: false })
    await expect(
      bffGet({ service: 'Spoonacular', path: '/v1/spoonacular/complex-search' })
    ).rejects.toThrow(BffQuotaExhaustedError)
  })

  it('fires onQuotaExhausted before throwing on 429', async () => {
    mockFetchOnce({}, { status: 429, ok: false })
    const invalidate = jest.fn().mockResolvedValueOnce(undefined)

    await expect(
      bffGet({
        service: 'Spoonacular',
        path: '/v1/spoonacular/complex-search',
        onQuotaExhausted: invalidate,
      })
    ).rejects.toThrow(BffQuotaExhaustedError)

    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('lets network errors propagate unchanged', async () => {
    const boom = new Error('connection refused')
    global.fetch = jest.fn().mockRejectedValueOnce(boom)
    await expect(
      bffGet({ service: 'OpenFoodFacts', path: '/v1/off/product/123' })
    ).rejects.toBe(boom)
  })
})
