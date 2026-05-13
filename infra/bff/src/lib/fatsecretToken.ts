import type { Env } from '../env'

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token'
const KV_KEY = 'fatsecret:oauth:token'

interface CachedToken {
  accessToken: string
  expiresAt: number
}

interface FSTokenResponse {
  access_token: string
  expires_in: number
}

/**
 * Returns a valid FatSecret OAuth2 bearer token, refreshing if needed.
 *
 * Token is cached across all Worker instances via KV under a single key.
 * FatSecret returns tokens with 24h TTL; we refresh 5 min before expiry.
 */
export async function getFatSecretToken(env: Env): Promise<string> {
  const cached = await env.TOKEN_CACHE_KV.get<CachedToken>(KV_KEY, 'json')

  if (cached && Date.now() < cached.expiresAt - 5 * 60 * 1000) {
    return cached.accessToken
  }

  const credentials = btoa(`${env.FATSECRET_CLIENT_ID}:${env.FATSECRET_CLIENT_SECRET}`)
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=basic',
  })

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`FatSecret token request failed (${resp.status}): ${body.slice(0, 200)}`)
  }

  const data = (await resp.json()) as FSTokenResponse
  const expiresAt = Date.now() + data.expires_in * 1000

  const entry: CachedToken = { accessToken: data.access_token, expiresAt }
  // KV expirationTtl is in seconds; store for slightly less than expiry to be safe.
  await env.TOKEN_CACHE_KV.put(KV_KEY, JSON.stringify(entry), {
    expirationTtl: Math.max(60, data.expires_in - 300),
  })

  return data.access_token
}
