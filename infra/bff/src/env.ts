export interface Env {
  // ── Secrets (set via `wrangler secret put …`; never committed) ──────────────
  FATSECRET_CLIENT_ID: string
  FATSECRET_CLIENT_SECRET: string
  SPOONACULAR_API_KEY: string

  // ── Vars (committed in wrangler.toml; non-sensitive) ────────────────────────
  SPOONACULAR_DAILY_LIMIT: string
  RATE_LIMIT_PER_MINUTE: string
  ENVIRONMENT: 'production' | 'staging' | 'dev'

  // ── KV bindings ─────────────────────────────────────────────────────────────
  RATE_LIMIT_KV: KVNamespace
  TOKEN_CACHE_KV: KVNamespace
  QUOTA_KV: KVNamespace
}

export type AppContext = {
  Bindings: Env
}
