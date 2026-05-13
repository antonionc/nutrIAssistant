# 03 — Security & Encryption

**Current state:** the app implements the four canonical security policies correctly at the local-first level, but key governance pieces are missing (key rotation, secret scanning, written threat model, SBOM). Each subsection is backed by evidence.

## 3.1. Data encryption policy

### Encryption at rest

| Aspect | Implementation | Evidence |
|---|---|---|
| Algorithm | **AES-256-GCM** | `src/services/encryption.ts:3,59,73` |
| Key size | 256 bits (32 bytes) | `src/services/encryption.ts:12,45` |
| Nonce | 96-bit random, unique per message | `src/services/encryption.ts:11,58` |
| Authentication tag | 128 bits (`@noble/ciphers` GCM default) | Implicit in `gcm(...).encrypt/decrypt` |
| Ciphertext blob format | `base64(nonce ‖ ciphertext ‖ tag)` | `src/services/encryption.ts:54-64` |
| Tamper detection | Decrypt throws on invalid tag → `tryDecrypt` returns the original | `src/services/encryption.ts:79-85` |
| Legacy-plaintext migration | Sentinel prefix `enc:v1:` to detect already-encrypted payloads | `src/modules/profiles/profileStorage.ts:13,27-36` |
| Coverage | Selective at field level: only `aboutMeNotes`, `conditions[]`, `member_memories.encrypted_text`, `doc_chunks.encrypted_text`, and `doc_chunks.embedding` | `src/modules/profiles/profileStorage.ts:68-72`, `src/services/memoryStore.ts:41-43,127-131` |
| Page-level SQLite encryption | ⚠️ GAP — standard SQLite, **no SQLCipher** | `src/db/database.ts:53` (`openDatabaseAsync('nutriassistant.db')` with no crypto options) |
| OS backups | Field-level encryption neutralizes the risk of automatic iCloud / Google Drive backup for covered fields. ⚠️ The rest of the JSON remains in plaintext in the backup | — |

### Encryption in transit

| Aspect | Implementation | Evidence |
|---|---|---|
| TLS 1.2/1.3 | OS default (URLSession on iOS, OkHttp on Android) | Implicit in `fetch` (`src/services/openFoodFacts.ts:69`, etc.) |
| Certificate pinning | ⚠️ GAP — not implemented | n/a |
| Service-to-service mTLS | ⚠️ GAP — n/a (no backend of our own) | — |
| ATS (iOS App Transport Security) | On by default; `NSAppTransportSecurity` is not modified in `app.json` | `app.json:15-25` |

### Field-level encryption

Active and well-designed (see table above). **It is the primary protection mechanism** and compensates for the absence of page-level SQLite encryption.

### Tokenization / pseudonymization

⚠️ GAP. Internal IDs are not pseudonymized. `FamilyMember.id` values come from `generateId('member')` (`src/utils/idUtils.ts`, referenced but not inspected). They are random → not PII in themselves, but since the data is strictly local this adds no value today. When a backend is introduced ([§8.1](./08-production-readiness.md#81-target-architecture-to-be)), pseudonyms must be generated separately from `user_account_id`.

## 3.2. Key storage policy

| Concept | Implementation | Evidence |
|---|---|---|
| Credentials (Edamam, Spoonacular) | Cloudflare Worker secret store, set via `wrangler secret put`; never in bundle, never in repo | `infra/bff/` — `EDAMAM_APP_ID`, `EDAMAM_APP_KEY`, `SPOONACULAR_API_KEY` |
| Runtime tokens | n/a — Edamam uses simple API key, Spoonacular uses API key; no OAuth state on device | — |
| Master cryptographic key | iOS Keychain / Android Keystore (via `expo-secure-store`) | `src/services/encryption.ts:35-46` |
| Hardware-backed | Device-dependent; `expo-secure-store` uses Keychain Class A on iOS and Android Keystore (HW-backed when the device supports it) | — |
| Rotation | ⚠️ GAP — no scheduled rotation | — |
| Key-store backup | iOS Keychain is NOT included in iCloud Backup by default when `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Android Keystore is non-exportable | `expo-secure-store` default |
| KMS / Secret Manager (server) | n/a (no server) | — |

**Prioritized recommendations:**

1. **Move secrets to a BFF** with Cloudflare Secret Manager / GCP Secret Manager. The client sees only an ephemeral signed token.
2. **Master-key rotation**: a campaign on major version bumps or when `cachedKey.length !== KEY_LEN` is detected (partial handling already in `src/services/encryption.ts:38-42`). Re-encrypt all `enc:v1:` blobs to `enc:v2:` with the new key in the background.
3. **Seed credentials with an explicit `KeychainAccess`**: today `expo-secure-store` uses the default accessibility. Force `accessibility: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` to ensure the key is never exfiltrated through backups.

## 3.3. User definition policy

| User type | How it is defined in the app | Privileges | Evidence |
|---|---|---|---|
| Administrator / DBA / Operations | ⚠️ N/A — no backend, no DBA. The "developer" has access to the source code and to `.env` | n/a | — |
| Interactive end user | Local family profile; one of the members marked `isSuperUser` | Full RW on local state; edits to other members are restricted | `src/types/profiles.ts:80`, `src/modules/profiles/ProfilesContext.tsx:55-62,107-114`, `app/settings.tsx:55,287-313` |
| Non-interactive user (job/script) | ⚠️ N/A — no external batch jobs | n/a | — |
| RBAC | "Super-user" vs normal profile — binary model | Only super-user can: add/delete profiles, edit other members, wipe DB, export family, delete all data | `app/settings.tsx:223-227,269-279,338-362,467-468,500-501` |
| ABAC | ⚠️ Not applicable | — | — |
| Least-privilege | Honored at the UI level: normal users do not see destructive buttons (`isSuperUser` gate in `app/settings.tsx:223,269,338,467,500`) | — | — |
| MFA | ⚠️ N/A (no login) | — | — |
| Role-change audit log | ⚠️ GAP — `isSuperUser` flips are not traced | — | `app/settings.tsx:293-300` |

**Defensive backfill**: if no profile is super-user at load time, the first one is auto-promoted (`src/modules/profiles/ProfilesContext.tsx:108-114`). Guarantees that there is always at least one admin per family. The last super-user cannot be demoted either (`app/settings.tsx:294-298,301-305`).

**Recommendation**: when accounts are introduced ([§8.1](./08-production-readiness.md#81-target-architecture-to-be)), distinguish the three canonical types:

1. **Administrators / support**: cloud panel with mandatory TOTP MFA.
2. **Interactive**: end users, with federated login (Apple/Google) and optional biometric PIN.
3. **Non-interactive**: jobs (nightly B2B sync, model retraining, Privacy Nutrition Labels generation), with service accounts and signed JWTs (24-hour rotation).

## 3.4. Observability policy (security lens)

| Aspect | State | Evidence |
|---|---|---|
| Structured logging | 🔴 GAP — only `console.log/warn/error` with ad-hoc strings | Cross-cutting search in `src/services/*.ts` |
| Levels | Only `log`, `warn`, `error`. No controllable `debug` | — |
| Retention | ⚠️ Logs only in dev console; in production nothing is persisted | — |
| PII-access audit log | 🔴 GAP — does not exist | — |
| Anomaly detection | 🔴 GAP | — |
| Alerts | 🔴 GAP | — |
| Per-service cost and usage | 🟡 Spoonacular global quota counter in BFF KV (`/v1/spoonacular/quota`); Edamam metered via free-tier monthly cap; OFF unmetered | `infra/bff/src/lib/spoonacularQuota.ts` |

**This gap is the most severe risk from a GDPR perspective:** without traceability, you cannot demonstrate accountability (Art. 5.2), detect breaches (Art. 33), or evidence legitimate access to Art. 9 data.

**Prioritized recommendations:**

1. **Install Sentry SDK** (`@sentry/react-native`) with aggressive PII scrubbing and blacklisted events. ~€0 cost on the free plan for prototype volume.
2. **Define local audit events** (append-only on an encrypted `audit_log` table) for: `PROFILE_VIEWED`, `DOC_OPENED`, `MEMORY_DELETED`, `BACKUP_EXPORTED`. Surface them to the user in a "My activity" screen.
3. **Structured logger**: small `logger.info(event, attrs)` wrapper emitting JSON with timestamp + category + pseudo `user_id` (no PII).

## 3.5. Threat model (simplified STRIDE)

| Threat | Applied description | Likelihood | Impact | Current mitigation | Recommended mitigation |
|---|---|---|---|---|---|
| **Spoofing** | Attacker decompiles IPA/APK looking for API keys to extract | Low — no `EXPO_PUBLIC_*` API keys ship in the bundle anymore | n/a (mitigation now in place) | All upstream calls go through the BFF; credentials never leave Cloudflare's secret store | Add per-IP rate limit and WAF rules on `api.nutriassistant.org` if abuse patterns emerge |
| **Tampering** | Attacker modifies the SQLite DB via jailbreak/root | Low on stock device, high with jailbreak | Compromise of planning and memories | Field-level encryption (prevents reading); ⚠️ does not prevent rewriting | SQLCipher to encrypt full pages |
| **Tampering** | `.pte` model tampered with on the CDN → poisoned responses | Very low (HF CDN with TLS) | Critical (harmful suggestions) | ⚠️ GAP — no SHA256 verification | Whitelisted hashes + fetch with verification |
| **Repudiation** | User denies having added allergens or changed a plan | Medium | Low | ⚠️ GAP — no audit log | Encrypted local audit log |
| **Information Disclosure** | iCloud/Google backup exfiltrates AsyncStorage without encryption | Medium | Critical (Art. 9 PII in cleartext) | Partial encryption (conditions, aboutMe). ⚠️ Everything else lives in the backup | Encrypt EVERY PII field; configure `setAttributesAsync` with `excludeFromBackup` for the doc dir |
| **Information Disclosure** | Clinical PDFs in `documentDirectory` not encrypted | High if the bundle is physically extracted | Critical | ⚠️ GAP | Encrypt PDFs on disk; decrypt into `cacheDirectory` right before `extractPdfText` |
| **Information Disclosure** | Embedding inversion attack: recover text from leaked embeddings | Low | Medium | Embeddings are encrypted | Same + never expose embeddings outside |
| **Information Disclosure** | LLM leaks one family's data to another (cross-tenant) | Zero (local, one family per device) | n/a | Physical isolation | — |
| **DoS** | Loop calls to Edamam or Spoonacular through the BFF | Low — BFF enforces per-IP rate limit + global daily quota | App degrades gracefully (429 surfaced as `Quota exhausted`) | BFF rate limit middleware + KV-backed daily counters | Move from KV fixed-window to platform `RateLimit` binding if hot spots appear |
| **DoS** | Recursive LLM generation (KV overflow) | Medium (used to happen with Llama 3.2 1B) | Broken UX | Prompt hard-cap at 4,500 chars + history cap at 4 turns + retry guard | `src/services/prompts/system.ts:52`, `src/modules/ai-engine/AIContext.tsx:43,194-210` |
| **Elevation of Privilege** | A non-super-user profile triggers the DB wipe | Low (UI gate) | Critical | UI switch (`isSuperUser` gate) | ⚠️ The gate is UI-only; an attacker with runtime access could call `wipeAndResetRecipes` directly. Implement the gate in the service too |

## 3.6. Secrets management in the repo

| Aspect | Implementation | Evidence | Recommendation |
|---|---|---|---|
| `.env` in gitignore | Likely — see `.gitignore` (lines with `.env*` expected) | `.gitignore` (537 bytes; not opened, but `.env` appears in `ls`) | Confirm and add `.env.local`, `.env.production` |
| Secrets in bundle | **🔴 Yes** — `EXPO_PUBLIC_FATSECRET_CLIENT_SECRET` ships in the binary | `.env:5-7` | Move to BFF + ephemeral signed token |
| CI secret scanning | 🔴 GAP — no `gitleaks`, `trufflehog`, or GitHub secret scanning | — | Enable GitHub Push Protection + a `gitleaks-action` workflow |
| `.env.example` | ✅ present, no real values | `.env.example:1-5` | — |
| Pre-commit hooks | 🔴 GAP — no `husky` or `.husky/` | — | Add a `pre-commit` that runs `gitleaks detect --staged` |

## 3.7. Dependencies and supply chain

| Aspect | Implementation | Evidence | Recommendation |
|---|---|---|---|
| Pinning | `package.json` uses caret (`^`) and tilde (`~`); `package-lock.json` versioned | `package.json:20-49`, `package-lock.json` (569 KB in the repo) | Keep the lockfile committed; use `npm ci` in CI |
| SBOM | 🔴 GAP — not generated (SPDX / CycloneDX) | — | Add `cyclonedx-bom` to the release CI |
| Vulnerability scanning | 🔴 GAP — no Dependabot/Snyk/Renovate | — | Enable Dependabot security updates on GitHub |
| License audit | 🔴 GAP — `license-checker` is not run | — | Add `npm run licenses` that fails on non-whitelisted licenses (AGPL, etc.) |
| AI model provenance | 🔴 GAP — origin and hash are not verified | — | Pin the SHA256 of each `.pte` and tokenizer in code + verify on load |
| Nutrition-source provenance | ✅ traced by `sourceApi` in `recipes` (`edamam|spoonacular|themealdb|user_created|ai_generated`) | `src/types/recipes.ts:38` | Document Data Sharing Agreements ([§6.7](./06-data-governance.md#67-data-sharing-agreements-with-third-parties)) |

**Prioritized recommendations:**

1. Enable **Dependabot** + **CodeQL** on GitHub (free).
2. Generate a **CycloneDX SBOM** on every release and publish to GitHub Releases.
3. Implement an **integrity check** for the `.pte` model on load (expected SHA256 in code).
4. Block non-deterministic `npm install` with exact `engines.npm` and `engines.node` in `package.json`.
5. Add **CONTRIBUTING.md** + **SECURITY.md** with a disclosure policy (`security@nutriassistant.ai`).
