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
| `GET /v1/llm/qwen3-1.7b/{model.pte,tokenizer.json,tokenizer_config.json}` | R2 `MODEL_BUCKET` | 1y immutable |

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

### 3b. Create the R2 bucket for on-device LLM artifacts

```bash
npx wrangler r2 bucket create nutriassistant-llm-models
npx wrangler r2 bucket create nutriassistant-llm-models-preview
```

Upload the model files (see [Mirroring the on-device LLM](#mirroring-the-on-device-llm) below).

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
| `.env` (in app repo) | Only `EXPO_PUBLIC_BFF_BASE_URL` — a public URL, safe to bundle | ❌ gitignored (kept for symmetry with `.env.example`) |
| `infra/bff/.dev.vars` | Local-dev Spoonacular + Edamam credentials | ❌ gitignored |
| `infra/bff/.dev.vars.example` | Placeholder names only, no values | ✅ committed for onboarding |
| `wrangler secret put` | Production secrets (`SPOONACULAR_API_KEY`, `EDAMAM_APP_ID`, `EDAMAM_APP_KEY`) | n/a — server-side only, never in repo |
| `wrangler.toml` `[vars]` | Non-sensitive config (`EDAMAM_ACCOUNT_USER`, `SPOONACULAR_DAILY_LIMIT`, env name) | ✅ committed |
| `infra/bff/src/env.ts` | TypeScript binding interface (`AppContext`) — what KV namespaces, R2 buckets, vars and secrets the Worker code expects | ✅ committed |

**Never put a real secret in `wrangler.toml`.** If you do, rotate the credential immediately — `wrangler.toml` is in git.

`SPOONACULAR_DAILY_LIMIT` in `wrangler.toml` is the **single source of truth** for the daily quota. The mobile app reads it live via `/v1/spoonacular/quota`; no quota constant ships in the bundle.

## Operations

- **Live logs:** `npx wrangler tail`
- **Analytics:** Cloudflare Dashboard → Workers & Pages → `nutriassistant-bff` → Metrics
- **Rollback:** Dashboard → Deployments tab → "Promote" a previous version
- **Quota check:** `curl https://api.nutriassistant.org/v1/spoonacular/quota`
- **List active secrets:** `npx wrangler secret list` (expect exactly `EDAMAM_APP_ID`, `EDAMAM_APP_KEY`, `SPOONACULAR_API_KEY`)

### Rotating a provider credential

Use this runbook when you need to rotate the Spoonacular API key or Edamam
`app_key` — either on a schedule, after a suspected leak, or after publishing
a binary that you suspect carried an older copy.

`wrangler secret put` **overwrites** an existing secret, so there is no
"delete first, then set" step. The Worker picks up the new value on the next
invocation (cold-start within ~30s); **no redeploy needed**.

#### Spoonacular

1. **Generate a new key at the provider.** Sign in at
   https://spoonacular.com/food-api/console → **Profile → My Console**.
   If Spoonacular offers "Generate new key" (a second key alongside the old),
   prefer that — zero downtime. Otherwise "Reset / regenerate" replaces the
   old key immediately (~1 min downtime).
2. **Update the Cloudflare secret:**
   ```bash
   cd infra/bff
   npx wrangler secret put SPOONACULAR_API_KEY
   # paste the new value at the prompt, Enter
   ```
3. **Verify:**
   ```bash
   curl -sS "https://api.nutriassistant.org/v1/spoonacular/complex-search?cuisine=italian&number=1"
   # expect a JSON body with `results: [...]`, NOT `spoonacular_upstream_401`
   ```
   If you get a 502 with `spoonacular_upstream_401`, the new key has not
   propagated yet — wait 60 seconds and retry, or `npx wrangler tail` to
   watch live.
4. **Revoke the old key** at Spoonacular (only after step 3 confirms the
   new key works). Older binaries that still ship with the old key will
   degrade gracefully: `getSpoonacularRecipeDetail` returns `null` and the
   app falls back to Edamam + on-device generation.

#### Edamam

Same shape, different URL. Sign in at https://developer.edamam.com/admin → your
application → **Rotate keys** (or **Regenerate app key**). Then:

```bash
cd infra/bff
npx wrangler secret put EDAMAM_APP_KEY    # paste new value
# EDAMAM_APP_ID rarely changes — only rotate it if the provider explicitly issues a new one.
```

Verify with:

```bash
curl -sS "https://api.nutriassistant.org/v1/edamam/recipes/search?q=paella&cuisineType=mediterranean" | head -c 200
# expect a JSON body with `hits: [...]`, NOT 502 `edamam_auth_error`
```

#### Emergency revocation (key leaked)

If a key is suspected leaked, **delete it at the provider first**, then set
the replacement on Cloudflare. This sequence accepts a few minutes of broken
catalog UX in exchange for cutting the leaked key off immediately. The app
remains usable throughout — on-device LLM, meal planning, profiles, AI chat,
and OpenFoodFacts scanning are all unaffected.

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

## Mirroring the on-device LLM

The mobile app downloads ~1 GB of model artifacts on first launch (Qwen 3 1.7B
Quantized). We mirror those files in R2 instead of hitting HuggingFace directly,
because:

- Cloudflare's global edge cuts first-launch download time vs. HF's CDN, which
  is geographically uneven and occasionally returns 5xx.
- R2 → Workers egress is free; we only pay storage (~$0.015/GB/month) and
  per-user egress (~$0.09/GB). Tokenizer JSONs are edge-cached after the first
  hit, so per-user egress is dominated by the .pte (~1 GB once per install).
- We control the SLA. A HuggingFace incident no longer breaks new installs.

### Files to upload

These are the three blobs `react-native-executorch` resolves for the
`QWEN3_1_7B_QUANTIZED` preset. Pin to `v0.8.0` of the upstream repo so we
serve a stable revision regardless of HuggingFace mutations:

| R2 key | HuggingFace URL |
|---|---|
| `qwen3-1.7b/model.pte` | https://huggingface.co/software-mansion/react-native-executorch-qwen-3/resolve/v0.8.0/qwen-3-1.7B/quantized/qwen3_1_7b_8da4w.pte |
| `qwen3-1.7b/tokenizer.json` | https://huggingface.co/software-mansion/react-native-executorch-qwen-3/resolve/v0.8.0/tokenizer.json |
| `qwen3-1.7b/tokenizer_config.json` | https://huggingface.co/software-mansion/react-native-executorch-qwen-3/resolve/v0.8.0/tokenizer_config.json |

### Upload procedure

One-time, after creating the bucket:

```bash
# Pull the three upstream files to disk.
mkdir -p /tmp/qwen3-1.7b && cd /tmp/qwen3-1.7b
curl -L -o model.pte              https://huggingface.co/software-mansion/react-native-executorch-qwen-3/resolve/v0.8.0/qwen-3-1.7B/quantized/qwen3_1_7b_8da4w.pte
curl -L -o tokenizer.json         https://huggingface.co/software-mansion/react-native-executorch-qwen-3/resolve/v0.8.0/tokenizer.json
curl -L -o tokenizer_config.json  https://huggingface.co/software-mansion/react-native-executorch-qwen-3/resolve/v0.8.0/tokenizer_config.json

# Push to R2. --remote skips the local sim cache.
cd infra/bff
npx wrangler r2 object put nutriassistant-llm-models/qwen3-1.7b/model.pte             --file=/tmp/qwen3-1.7b/model.pte             --remote
npx wrangler r2 object put nutriassistant-llm-models/qwen3-1.7b/tokenizer.json        --file=/tmp/qwen3-1.7b/tokenizer.json        --remote
npx wrangler r2 object put nutriassistant-llm-models/qwen3-1.7b/tokenizer_config.json --file=/tmp/qwen3-1.7b/tokenizer_config.json --remote

# Verify.
curl -sI https://api.nutriassistant.org/v1/llm/qwen3-1.7b/tokenizer.json | head
# expect: HTTP/2 200, content-type: application/json, cache-control: ...immutable
```

For the preview/staging bucket, repeat with `nutriassistant-llm-models-preview`.

### Upgrading the model

When migrating to a newer Qwen revision (or a different model entirely):

1. Pick a new R2 namespace (e.g. `qwen3-1.7b-v2/` or `qwen2.5-3b/`).
2. Upload the new files under that namespace via `wrangler r2 object put`.
3. Add the new namespace to `ALLOWED_MODELS` in `infra/bff/src/routes/llm.ts`.
4. In `src/services/onDeviceLlm.ts`, update `LLM_BASE` to the new namespace
   AND bump `KEY_MODEL_FIRST_LOAD` to a fresh suffix — different URL means
   the executorch fetcher writes to a fresh cache filename, so the sticky
   "already loaded" flag must reset.
5. Once installs have migrated, delete the old namespace's R2 objects to
   stop paying storage on the legacy revision.

Do NOT overwrite files in-place under the same R2 key. The route sets
`cache-control: immutable, max-age=1y`, so a same-key replacement won't
propagate to clients (or to the CF edge cache) until the cache expires.

## Client-side integration

All three upstreams now reach this BFF through a single shared client at
[`src/services/bff/client.ts`](../../src/services/bff/client.ts). Provider
services (`edamam.ts`, `spoonacular.ts`, `openFoodFacts.ts`) call `bffGet()`
and translate the typed `BffError` / `BffQuotaExhaustedError` into
provider-specific UX. There is no fetch wrapper, base URL constant, or error
envelope duplicated in the per-provider files.

To add a new provider:

1. Add the route under `infra/bff/src/routes/<provider>.ts` and wire it into `src/index.ts`.
2. In the app, create `src/services/<provider>.ts` that calls `bffGet('/v1/<provider>/...')` and maps the response.
3. If the provider has a quota, surface it via a `/v1/<provider>/quota` route and read it with `getSpoonacularQuotaSnapshot()`-style helper.

The mappers (`mapNutriments`, `buildStub`, etc.) need no changes — the BFF returns upstream JSON unchanged.

### Migration history

| Date | Commit | Change |
|---|---|---|
| 2026-05-13 | `b87bf26` | BFF scaffolded on Cloudflare Workers |
| 2026-05-13 | `39f9925` | Deployed to `api.nutriassistant.org` |
| 2026-05-13 | `adb2483` | FatSecret replaced by Edamam Recipe Search v2 |
| 2026-05-13 | `1647aac` | Spoonacular + OpenFoodFacts routed through BFF; **last upstream-direct call removed**, mobile bundle now ships zero third-party API keys |
| 2026-05-13 | `c27c0d7` | Shared `bffGet()` client extracted (`src/services/bff/client.ts`) + 9-test suite |
| 2026-05-13 | `ae7e019` | Credential rotation runbook added (above) |
| 2026-05-13 | `7b4630d` | Streaming LLM response handling fixed in BFF; on-device model artifacts mirrored via R2 |
