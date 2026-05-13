# NutrIAssistant BFF

Backend-For-Frontend on Cloudflare Workers. Sits between the mobile app and three third-party APIs so **API secrets never ship in the IPA/APK**.

```
┌─────────────────┐  HTTPS  ┌────────────────────┐  HTTPS+secret  ┌─────────────────────┐
│  NutrIAssistant │ ───────►│  Cloudflare Worker │ ──────────────►│  OpenFoodFacts /    │
│  (iOS/Android)  │         │  api.nutriassis-   │                │  Spoonacular /      │
│                 │◄─────── │  tant.org          │◄────────────── │  Edamam             │
└─────────────────┘         └────────────────────┘                └─────────────────────┘
       ▲                            │
       │ public route               │ secrets in CF env
       │ no secrets in bundle       │ rewritten pagination URLs
       │                            │ KV daily quota counter
                                    │ edge-cached responses
```

## What this gives you

| Concern | Before (direct calls) | After (BFF) |
|---|---|---|
| Secrets in IPA/APK | 🔴 Spoonacular + Edamam keys baked into the bundle | ✅ Only `api.nutriassistant.org` shipped (public URL) |
| API quota abuse | 🔴 One compromised key → bill shock | ✅ Per-IP rate limit + global daily quota cap |
| Pagination credential leak | 🔴 Edamam responses embed `app_key` in `_links.next.href` | ✅ Deep-walked + rewritten to BFF URLs |
| Catalog response cost | Every device hits upstream | ✅ 1-24h edge cache shared across users |
| Schrems II posture | Devices in EU calling US APIs directly | ✅ EU Worker proxies; user traffic stays in EU |
| Operational visibility | None | ✅ Worker Analytics + structured logs |

## Endpoints

| Path | Upstream | Edge cache |
|---|---|---|
| `GET /v1/health` | — | none |
| `GET /v1/off/product/:barcode` | OpenFoodFacts | 24h |
| `GET /v1/edamam/recipes/search?q=…&cuisineType=…&mealType=…&diet=…&health=…` | Edamam `/api/recipes/v2` | 1h |
| `GET /v1/edamam/recipes/:id` | Edamam `/api/recipes/v2/:id` | 6h |
| `GET /v1/spoonacular/complex-search?cuisine=…&number=…&offset=…&sort=…` | Spoonacular `/recipes/complexSearch` | 1h |
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
npx wrangler secret put SPOONACULAR_API_KEY
npx wrangler secret put EDAMAM_APP_ID
npx wrangler secret put EDAMAM_APP_KEY
```

Edamam's `Edamam-Account-User` is not a secret (just a username identifier
for free-tier metering) and lives in `wrangler.toml` under `[vars]`.

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
| `infra/bff/.dev.vars` | Local-dev Spoonacular + Edamam credentials | ❌ gitignored |
| `infra/bff/.dev.vars.example` | Placeholder names only, no values | ✅ committed for onboarding |
| `wrangler secret put` | Production secrets | n/a — server-side only, never in repo |
| `wrangler.toml` `[vars]` | Non-sensitive config (rate-limit, env name) | ✅ committed |

**Never put a real secret in `wrangler.toml`.** If you do, rotate the credential immediately — `wrangler.toml` is in git.

## Operations

- **Live logs:** `npx wrangler tail`
- **Analytics:** Cloudflare Dashboard → Workers & Pages → `nutriassistant-bff` → Metrics
- **Rollback:** Dashboard → Deployments tab → "Promote" a previous version
- **Quota check:** `curl https://api.nutriassistant.org/v1/spoonacular/quota`

## Provider-specific gotchas

### OpenFoodFacts: use the `.net` alias, not `.org`

`world.openfoodfacts.org` is fronted by Cloudflare. Workers calling another
Cloudflare-fronted origin hits persistent **HTTP 525 (SSL handshake failed)**
errors on the zone-to-zone path. The `.net` alias resolves to the same
backend without the CF front. The `off.ts` route uses `.net` for this
reason.

### Edamam: response leaks credentials in pagination links

Edamam's Recipe Search v2 embeds the raw `app_id` and `app_key` in every
`_links.*.href` URL (top-level `next` link and per-recipe `self` link).
Forwarding the response untouched would defeat the BFF's whole purpose.

`routes/edamam.ts` deep-walks the response and rewrites every Edamam URL
to its BFF equivalent, stripping the credential query params. Verified
with `grep -c 'app_key' response.json` returning 0 on real searches.

### Edamam: `Edamam-Account-User` header is mandatory

Free-tier metering relies on the `Edamam-Account-User` header — every
Recipe Search v2 call must include it. The BFF injects this from the
`EDAMAM_ACCOUNT_USER` var in `wrangler.toml`. Without it, Edamam returns
HTTP 401 even with valid `app_id`/`app_key`.

### Spoonacular: global daily quota

Default is 10,000 calls/day across **all clients combined** (free plan is
150/day). The BFF tracks usage in `QUOTA_KV` and refuses upstream calls
once the cap is hit. Override via `SPOONACULAR_DAILY_LIMIT` in
`wrangler.toml`.

## Architecture notes

- **Rate limit** is per-IP, fixed-window 1-minute, KV-backed. Best-effort under bursty load (KV is eventually consistent). For stricter guarantees, switch to the platform `RateLimit` binding (Workers Paid, $5/mo) — same interface, just swap the middleware.
- **Edge cache** is Cloudflare's free `caches.default`. Keyed by full URL including query string. Non-200 responses are NOT cached (so an upstream outage cannot poison the cache).
- **Edamam response sanitization:** Edamam embeds raw `app_id`/`app_key` in every `_links.*.href`. `routes/edamam.ts` deep-walks the response and rewrites those URLs to BFF equivalents before returning to the client.
- **Spoonacular quota** is global, not per-device. The old per-device counter was security theater (a malicious user could just reset their device). With BFF tracking, we know the real upstream usage and can disable proactively before bill shock.
- **`TOKEN_CACHE_KV`** is retained (formerly held FatSecret OAuth tokens). Not actively used today but free and convenient for future OAuth-style providers.

## Migration path (Phase 2, separate task)

Once the BFF is verified:

1. Add `EXPO_PUBLIC_BFF_BASE_URL=https://api.nutriassistant.org` to the app `.env` (this one IS safe to bundle — it's a public URL).
2. Replace upstream URLs in:
   - `src/services/openFoodFacts.ts:3` → `${BFF}/v1/off/product/${barcode}`
   - `src/services/edamam.ts` already goes through `${BFF}/v1/edamam/...` (this is the canonical pattern; copy it for OFF + Spoonacular).
   - `src/services/spoonacular.ts:7` → remove `apiKey` param, hit `${BFF}/v1/spoonacular/...`
3. Delete `EXPO_PUBLIC_SPOONACULAR_API_KEY` from the app `.env`.
4. Rotate the upstream credentials at the providers (Spoonacular dashboard). Anyone who downloaded a previous binary still has the old keys; rotating invalidates them. Edamam credentials never shipped in any binary so no rotation needed.

The mappers (`mapNutriments`, `buildStub`, etc.) need no changes — the BFF returns the same shapes.
