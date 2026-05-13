# NutrIAssistant BFF

Backend-For-Frontend on Cloudflare Workers. Sits between the mobile app and three third-party APIs so **API secrets never ship in the IPA/APK**.

```
┌─────────────────┐  HTTPS  ┌────────────────────┐  HTTPS+secret  ┌─────────────────────┐
│  NutrIAssistant │ ───────►│  Cloudflare Worker │ ──────────────►│  OpenFoodFacts /    │
│  (iOS/Android)  │         │  api.nutriassis-   │                │  FatSecret /        │
│                 │◄─────── │  tant.org          │◄────────────── │  Spoonacular        │
└─────────────────┘         └────────────────────┘                └─────────────────────┘
       ▲                            │
       │ public route               │ secrets in CF env
       │ no secrets in bundle       │ KV-cached OAuth token
       │                            │ KV daily quota counter
                                    │ edge-cached responses
```

## What this gives you

| Concern | Before (direct calls) | After (BFF) |
|---|---|---|
| Secrets in IPA/APK | 🔴 FatSecret + Spoonacular keys baked into the bundle | ✅ Only `api.nutriassistant.org` shipped (public URL) |
| API quota abuse | 🔴 One compromised key → bill shock | ✅ Per-IP rate limit + global daily quota cap |
| Token caching | Per-device in AsyncStorage | ✅ Global in Cloudflare KV (one OAuth refresh for all users) |
| Catalog response cost | Every device hits upstream | ✅ 1-24h edge cache shared across users |
| Schrems II posture | Devices in EU calling US APIs directly | ✅ EU Worker proxies; user traffic stays in EU |
| Operational visibility | None | ✅ Worker Analytics + structured logs |

## Endpoints

| Path | Upstream | Edge cache |
|---|---|---|
| `GET /v1/health` | — | none |
| `GET /v1/off/product/:barcode` | OpenFoodFacts | 24h |
| `GET /v1/fatsecret/recipes/search?q=...&max_results=...` | FatSecret `/recipes/search/v3` | 1h |
| `GET /v1/fatsecret/recipes/:id` | FatSecret `/recipe/v2` | 6h |
| `GET /v1/spoonacular/complex-search?cuisine=...&number=...&offset=...&sort=...` | Spoonacular `/recipes/complexSearch` | 1h |
| `GET /v1/spoonacular/recipes/:id?includeNutrition=true` | Spoonacular `/recipes/:id/information` | 6h |
| `GET /v1/spoonacular/quota` | — (KV read) | none |

All endpoints return the **upstream JSON unchanged** so existing client-side mappers keep working.

## One-time setup

### 1. Install dependencies

```bash
cd infra/bff
npm install
```

### 2. Authenticate with Cloudflare

```bash
npx wrangler login
```

Pick the account that owns `nutriassistant.org`.

### 3. Create the three KV namespaces

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
npx wrangler kv namespace create RATE_LIMIT_KV --preview
npx wrangler kv namespace create TOKEN_CACHE_KV
npx wrangler kv namespace create TOKEN_CACHE_KV --preview
npx wrangler kv namespace create QUOTA_KV
npx wrangler kv namespace create QUOTA_KV --preview
```

Each command prints an `id`. Paste them into `wrangler.toml` replacing the `REPLACE_WITH_*` placeholders.

### 4. Set production secrets

These NEVER touch git — they go straight to Cloudflare's encrypted secret store:

```bash
npx wrangler secret put FATSECRET_CLIENT_ID
npx wrangler secret put FATSECRET_CLIENT_SECRET
npx wrangler secret put SPOONACULAR_API_KEY
```

Each prompts you to paste the value, then stores it server-side. The Cloudflare dashboard only ever shows the variable name, never the value.

### 5. Bind the custom domain

In the Cloudflare dashboard:
- **Workers & Pages** → `nutriassistant-bff` → **Settings** → **Domains & Routes** → **Add Custom Domain** → `api.nutriassistant.org`.

Cloudflare provisions the certificate automatically. The route is already declared in `wrangler.toml`; the dashboard binding is what wires DNS to the Worker.

### 6. Deploy

```bash
npx wrangler deploy
```

That's it. Verify:

```bash
curl https://api.nutriassistant.org/v1/health
# {"status":"ok","environment":"production","timestamp":"..."}

curl https://api.nutriassistant.org/v1/off/product/8410069101226
# {"status":1,"product":{...}}
```

## Local development

Copy the example env file and fill in dev credentials:

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars with real values for local testing
```

`.dev.vars` is gitignored — values stay on your machine.

Run:

```bash
npm run dev
```

The Worker is available at `http://localhost:8787`. KV bindings use the `preview_id` namespaces so you don't pollute production counters.

## Secrets policy

| Where | What's in it | Committed? |
|---|---|---|
| `.env` (in app repo) | Old `EXPO_PUBLIC_*` vars | ❌ gitignored, deprecated once app is migrated |
| `infra/bff/.dev.vars` | Local-dev FatSecret + Spoonacular credentials | ❌ gitignored |
| `infra/bff/.dev.vars.example` | Placeholder names only, no values | ✅ committed for onboarding |
| `wrangler secret put` | Production secrets | n/a — server-side only, never in repo |
| `wrangler.toml` `[vars]` | Non-sensitive config (rate-limit, env name) | ✅ committed |

**Never put a real secret in `wrangler.toml`.** If you do, rotate the credential immediately — `wrangler.toml` is in git.

## Operations

- **Live logs:** `npx wrangler tail`
- **Analytics:** Cloudflare Dashboard → Workers & Pages → `nutriassistant-bff` → Metrics
- **Rollback:** Dashboard → Deployments tab → "Promote" a previous version
- **Quota check:** `curl https://api.nutriassistant.org/v1/spoonacular/quota`

## Architecture notes

- **Rate limit** is per-IP, fixed-window 1-minute, KV-backed. Best-effort under bursty load (KV is eventually consistent). For stricter guarantees, switch to the platform `RateLimit` binding (Workers Paid, $5/mo) — same interface, just swap the middleware.
- **Edge cache** is Cloudflare's free `caches.default`. Keyed by full URL including query string. Non-200 responses are NOT cached (so an upstream outage cannot poison the cache).
- **Token cache:** FatSecret OAuth bearer token lives in `TOKEN_CACHE_KV`, refreshed 5 min before expiry. One refresh per ~24h serves the entire user base.
- **Spoonacular quota** is global, not per-device. The old per-device counter was security theater (a malicious user could just reset their device). With BFF tracking, we know the real upstream usage and can disable proactively before bill shock.

## Migration path (Phase 2, separate task)

Once the BFF is verified:

1. Add `EXPO_PUBLIC_BFF_BASE_URL=https://api.nutriassistant.org` to the app `.env` (this one IS safe to bundle — it's a public URL).
2. Replace upstream URLs in:
   - `src/services/openFoodFacts.ts:3` → `${BFF}/v1/off/product/${barcode}`
   - `src/services/fatsecret.ts:7-12` → remove OAuth code entirely, hit `${BFF}/v1/fatsecret/...`
   - `src/services/spoonacular.ts:7` → remove `apiKey` param, hit `${BFF}/v1/spoonacular/...`
3. Delete `FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET`, `SPOONACULAR_API_KEY` from the app `.env`.
4. Rotate the upstream credentials at the providers (FatSecret + Spoonacular dashboards). Anyone who downloaded a previous binary still has the old keys; rotating invalidates them.

The mappers (`mapNutriments`, `toArray`, `buildStub`, etc.) need no changes — the BFF returns the same shapes.
