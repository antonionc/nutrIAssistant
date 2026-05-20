# 03 — Security & Encryption

**Current state (post commit `aaa3179`):** the four canonical security policies are implemented at the local-first level, **plus** the previously-flagged governance pieces have been closed during the five-sprint pass: full Art. 9 field encryption (sprint 2), PDFs at-rest encryption (sprint 2), manual master-key rotation (sprint 5), CI secret scanning + Dependabot + CycloneDX SBOM (sprint 4), and an encrypted local audit log with pseudonymised identifiers (sprints 1 + 5 backlog). The remaining items are all third-party-spend dependent (formal external pen-test, threat-model sign-off by an external party). Each subsection is backed by evidence.

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
| Coverage | Full Art. 9 field-level coverage on profiles (`weight`, `height`, `dateOfBirth`, `allergies`, `conditions`, `aboutMeNotes`) plus `member_memories.encrypted_text` + nullable `embedding`, `doc_chunks.encrypted_text` + `embedding`, the encrypted `audit_log` payload, and `.pdf.enc` files at rest. Plaintext remainders (`name`, `role`, `avatarUrl`, `dietPreference`) are needed for pre-key-unlock profile-picker rendering and are intentionally low-sensitivity. | `src/modules/profiles/profileStorage.ts:143-151`, `src/services/memoryStore.ts:41-43,127-131`, `src/services/profileDocuments.ts`, `src/services/auditLog.ts` |
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

✅ Partial. `FamilyMember.id` and `ProfileDocument.id` are random (`src/utils/idUtils.ts`), not PII by themselves. **Inside the encrypted audit-log payloads**, member/document identifiers are SHA-256-hashed with a salt and truncated to 48 bits via `pseudonymise()` in `src/services/auditLog.ts`. An attacker who eventually obtains the master key sees `memberRef: "a1b2c3d4e5f6"` instead of `member-7f3e9c-2024-...`, which prevents rebuilding a who-uploaded-what dictionary from the audit log alone (Art. 32). When a backend is introduced ([§8.1](./08-production-readiness.md#81-target-architecture-to-be)), pseudonyms must continue to be generated separately from any `user_account_id`.

## 3.2. Key storage policy

| Concept | Implementation | Evidence |
|---|---|---|
| Credentials (Edamam, Spoonacular) | Cloudflare Worker secret store, set via `wrangler secret put`; never in bundle, never in repo | `infra/bff/` — `EDAMAM_APP_ID`, `EDAMAM_APP_KEY`, `SPOONACULAR_API_KEY` |
| Runtime tokens | n/a — Edamam uses simple API key, Spoonacular uses API key; no OAuth state on device | — |
| Master cryptographic key | iOS Keychain / Android Keystore (via `expo-secure-store`) | `src/services/encryption.ts:35-46` |
| Hardware-backed | Device-dependent; `expo-secure-store` uses Keychain Class A on iOS and Android Keystore (HW-backed when the device supports it) | — |
| Rotation | 🟡 **Manual implemented** — Settings → Security → "Rotate encryption key" streams the re-encryption (DB columns in 100-row batches, PDFs one-at-a-time, ~5 MB peak heap) and atomically swaps the key in SecureStore. Scheduled / time-based rotation still pending. | `src/services/keyRotation.ts`; UI hook in `app/settings.tsx`; audit events `key_rotation_started` / `key_rotation_completed` |
| Key-store backup | iOS Keychain is NOT included in iCloud Backup by default when `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Android Keystore is non-exportable | `expo-secure-store` default |
| KMS / Secret Manager (server) | n/a (no server) | — |

**Prioritized recommendations:**

1. **Move secrets to a BFF** with Cloudflare Secret Manager / GCP Secret Manager. The client sees only an ephemeral signed token.
2. **Master-key rotation** — manual rotation implemented in `src/services/keyRotation.ts` and exposed in Settings. Outstanding: scheduled rotation (cron-like on major version bumps), and progressing to a versioned ciphertext prefix (`enc:v1:` → `enc:v2:`) so the rotation can interleave with new encrypt() calls instead of running as a one-shot atomic swap. Current swap is acceptable for manual user-triggered rotations but doesn't scale to background scheduled rotation.
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
| Role-change audit log | ⚠️ Partial — the `audit_log` table accepts the events but `isSuperUser` toggles in settings do not yet record one. New event type needed. | — | `app/settings.tsx`; `src/services/auditLog.ts` (add `role_changed` to `AuditEventType`) |

**Defensive backfill**: if no profile is super-user at load time, the first one is auto-promoted (`src/modules/profiles/ProfilesContext.tsx:108-114`). Guarantees that there is always at least one admin per family. The last super-user cannot be demoted either (`app/settings.tsx:294-298,301-305`).

**Recommendation**: when accounts are introduced ([§8.1](./08-production-readiness.md#81-target-architecture-to-be)), distinguish the three canonical types:

1. **Administrators / support**: cloud panel with mandatory TOTP MFA.
2. **Interactive**: end users, with federated login (Apple/Google) and optional biometric PIN.
3. **Non-interactive**: jobs (nightly B2B sync, model retraining, Privacy Nutrition Labels generation), with service accounts and signed JWTs (24-hour rotation).

## 3.4. Observability policy (security lens)

| Aspect | State | Evidence |
|---|---|---|
| Structured logging | 🟡 **Logger wrapper in place** — every `console.*` migrated to `src/utils/logger.ts` with PII scrubbing. Remote sink (Sentry) still deferred. | `src/utils/logger.ts`; `grep -rn "console\." src/ app/ \| grep -v "utils/logger\|__tests__"` returns 0 |
| Levels | Only `log`, `warn`, `error`. No controllable `debug` | — |
| Retention | ⚠️ Logs only in dev console; in production nothing is persisted | — |
| PII-access audit log | ✅ **Implemented** — encrypted `audit_log` table (migration 014); 11 event types covering consent, erasure, export, PDF uploads, key rotations, retention sweeps, decrypt failures, parental consents. IDs pseudonymised. | `src/services/auditLog.ts`, `src/db/migrations/014_audit_log.ts`, `app/audit-log.tsx` (UI) |
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
| **Tampering** | `.pte` model tampered with on the CDN → poisoned responses | Very low (HF CDN with TLS) | Critical (harmful suggestions) | 🟡 `verifyArtifactSha256()` hook ready in `src/services/onDeviceLlm.ts`; `EXPECTED_*_SHA256` constants currently empty (pinned at the moment the BFF upload runbook produces the hashes). | Populate the pins as soon as the next R2 upload runs. |
| **Repudiation** | User denies having added allergens or changed a plan | Medium | Low | ✅ Encrypted local audit log via migration 014 + `src/services/auditLog.ts` — covers consent, erasure, export, PDF uploads, key rotation, parental consent | — |
| **Information Disclosure** | iCloud/Google backup exfiltrates AsyncStorage without encryption | Medium | Critical (Art. 9 PII in cleartext) | Partial encryption (conditions, aboutMe). ⚠️ Everything else lives in the backup | Encrypt EVERY PII field; configure `setAttributesAsync` with `excludeFromBackup` for the doc dir |
| **Information Disclosure** | Clinical PDFs in `documentDirectory` not encrypted | High if the bundle is physically extracted | Critical | ✅ PDFs land as `<id>.pdf.enc` via `src/services/secureFileStore.ts`. Boot migration rewrites legacy plaintext. `extractPdfText` reads through `readEncryptedToTemp()` which decrypts into `cacheDirectory` and disposes after use. Caveat: iCloud/Google Drive backup still includes the ciphertext (`excludeFromBackup` API not exposed by expo-file-system v55 — documented in `docs/store-readiness/privacy-labels.md`). | Native module for `NSURLIsExcludedFromBackupKey` when budget allows. |
| **Information Disclosure** | Embedding inversion attack: recover text from leaked embeddings | Low | Medium | Embeddings are encrypted | Same + never expose embeddings outside |
| **Information Disclosure** | LLM leaks one family's data to another (cross-tenant) | Zero (local, one family per device) | n/a | Physical isolation | — |
| **DoS** | Loop calls to Edamam or Spoonacular through the BFF | Low — BFF enforces per-IP rate limit + global daily quota | App degrades gracefully (429 surfaced as `Quota exhausted`) | BFF rate limit middleware + KV-backed daily counters | Move from KV fixed-window to platform `RateLimit` binding if hot spots appear |
| **DoS** | Recursive LLM generation (KV overflow) | Medium (used to happen with Llama 3.2 1B) | Broken UX | Prompt hard-cap at 4,500 chars + history cap at 4 turns + retry guard | `src/services/prompts/system.ts:52`, `src/modules/ai-engine/AIContext.tsx:43,194-210` |
| **Elevation of Privilege** | A non-super-user profile triggers the DB wipe | Low (UI gate) | Critical | UI switch (`isSuperUser` gate) | ⚠️ The gate is UI-only; an attacker with runtime access could call `wipeAndResetRecipes` directly. Implement the gate in the service too |

## 3.6. Secrets management in the repo

| Aspect | Implementation | Evidence | Recommendation |
|---|---|---|---|
| `.env` in gitignore | Likely — see `.gitignore` (lines with `.env*` expected) | `.gitignore` (537 bytes; not opened, but `.env` appears in `ls`) | Confirm and add `.env.local`, `.env.production` |
| Secrets in bundle | **✅ No** — only `EXPO_PUBLIC_BFF_BASE_URL` (a public URL) ships. Historically `EXPO_PUBLIC_FATSECRET_*` and `EXPO_PUBLIC_SPOONACULAR_API_KEY` were bundled; resolved in commit `1647aac` by routing all three catalogs through the BFF. Provider secrets now live exclusively in Cloudflare's encrypted secret store. | `.env.example`, `infra/bff/wrangler.toml`, `infra/bff/README.md` (rotation runbook) | Quarterly rotation via `wrangler secret put` (runbook in BFF README) |
| CI secret scanning | ✅ **`.github/workflows/gitleaks.yml`** runs on every push + PR with `zricethezav/gitleaks-action@v2`. Pair with GitHub Push Protection (org-level toggle). | `.github/workflows/gitleaks.yml` |
| `.env.example` | ✅ present, no real values | `.env.example:1-5` | — |
| Pre-commit hooks | 🔴 GAP — no `husky` or `.husky/`. CI gitleaks covers the post-push surface; pre-commit would catch leaks before they reach the remote. | — | Add a `pre-commit` that runs `gitleaks detect --staged` |

## 3.7. Dependencies and supply chain

| Aspect | Implementation | Evidence | Recommendation |
|---|---|---|---|
| Pinning | `package.json` uses caret (`^`) and tilde (`~`); `package-lock.json` versioned | `package.json:20-49`, `package-lock.json` (569 KB in the repo) | Keep the lockfile committed; use `npm ci` in CI |
| SBOM | ✅ **CycloneDX SBOM** emitted per release by `.github/workflows/sbom.yml`. Builds both the app SBOM and the BFF SBOM, uploads them as release assets. | `.github/workflows/sbom.yml` |
| Vulnerability scanning | ✅ **Dependabot** weekly for the app, BFF and GitHub Actions versions (`.github/dependabot.yml`). Open-PR limit and grouping rules configured. | `.github/dependabot.yml` |
| License audit | ✅ **`license-checker` whitelist** in the SBOM workflow — fails on any AGPL/GPL/LGPL dependency. | `.github/workflows/sbom.yml` (last step) |
| AI model provenance | 🟡 **Engineering hook ready** — `verifyArtifactSha256()` + `EXPECTED_*_SHA256` constants in `src/services/onDeviceLlm.ts`. Pins are currently empty strings (which the verify function treats as "skip"); populate them at the next R2 upload following `infra/bff/README.md#mirroring-the-on-device-llm`. | `src/services/onDeviceLlm.ts` |
| Nutrition-source provenance | ✅ traced by `sourceApi` in `recipes` (`edamam|spoonacular|themealdb|user_created|ai_generated`) | `src/types/recipes.ts:38` | Document Data Sharing Agreements ([§6.7](./06-data-governance.md#67-data-sharing-agreements-with-third-parties)) |

**Prioritized recommendations:**

1. Enable **Dependabot** + **CodeQL** on GitHub (free).
2. Generate a **CycloneDX SBOM** on every release and publish to GitHub Releases.
3. Implement an **integrity check** for the `.pte` model on load (expected SHA256 in code).
4. Block non-deterministic `npm install` with exact `engines.npm` and `engines.node` in `package.json`.
5. Add **CONTRIBUTING.md** + **SECURITY.md** with a disclosure policy (`security@nutriassistant.org`).
