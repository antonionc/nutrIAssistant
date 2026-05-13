# 00 — Executive Summary

> Technical-strategic data architecture document. Repository status at the time of writing: **prototype `v1.0.0` in development**, **100% on-device** architecture, no backend of our own. Every statement is backed by code citations (`path/file.ext:Lnn-Lnn`), `package.json`, `app.json`, etc. Anything absent from the repo is flagged `⚠️ GAP`.

---

## Phase 0 — Exploration summary

**Detected stack**

- **Client:** React Native (`0.83.6`) + React (`19.2.0`) on Expo SDK 55, TypeScript 5.9, Hermes enabled, New Architecture enabled (`app.json:10`), experimental React Compiler enabled (`app.json:79-82`). Routing via `expo-router` with `typedRoutes` (`app.json:80`). Evidence: `package.json:18-49`.
- **Platforms:** iOS 18.1+ (`app.json:13`) and Android (package `com.anonymous.nutrIAssistant`, `app.json:39`). Web compiles to a static demo landing (`app.json:42`); not a target platform.
- **Backend of our own:** ⚠️ GAP — **does not exist**. All logic, persistence and AI runs on the device.
- **Local persistence:** SQLite via `expo-sqlite ~55.0.15` (12 migrations, WAL journal, `foreign_keys=ON`, see `src/db/database.ts:53-56`). AsyncStorage for serialized profiles and flags (`@react-native-async-storage/async-storage 2.2.0`, `package.json:21`). FileSystem for PDFs and avatars.
- **Secure store:** iOS Keychain / Android Keystore via `expo-secure-store ~55.0.13` (`package.json:38`) — solely the AES master key.
- **Crypto:** `@noble/ciphers ^2.2.0` (AES-256-GCM, `package.json:22`) + `expo-crypto` for `getRandomBytes` (`src/services/encryption.ts:45,58`).
- **On-device AI:** `react-native-executorch ^0.8.3` with the Expo resource-fetcher (`react-native-executorch-expo-resource-fetcher ^0.8.0`, `package.json:46-47`). Models: **Qwen 3 1.7B Quantized** (`src/services/onDeviceLlm.ts:24,44-47`) and **all-MiniLM-L6-v2** for embeddings (`src/services/embeddings.ts:21-22,33`).
- **Health (wearables):** `react-native-health` (Apple Health, optional) and `react-native-health-connect` (Google Health Connect, optional) loaded through defensive `require` (`src/modules/health/providers/appleHealth.ts:22-28`, `healthConnect.ts:23-29`). Not listed as explicit dependencies in `package.json` — presumed experimental or removed from the manifest.
- **Camera and OCR:** `expo-camera` (EAN13/EAN8/UPC-A/UPC-E/QR barcode scanner — `app/scanner.tsx:158`).
- **PDFs:** custom Expo native module `expo-pdf-text` (Swift in `modules/expo-pdf-text/ios/ExpoPdfTextModule.swift`, Kotlin in `modules/expo-pdf-text/android/src/main/java/expo/modules/pdftext/ExpoPdfTextModule.kt`) to extract text from clinical PDFs.
- **External APIs:** three nutrition/recipe catalog providers (see [§2.2](./02-data-model-architecture.md#22-data-source-classification)): **OpenFoodFacts** (no auth), **Edamam** Recipe Search v2 (`app_id` + `app_key`), and **Spoonacular** (API key). **All three are reached only through the BFF** at `api.nutriassistant.org`; the app binary holds zero third-party credentials. Client services live in `src/services/{openFoodFacts,edamam,spoonacular}.ts`, all built on `src/services/bff/client.ts`. Legacy: FatSecret was removed in migration 013; TheMealDB in migration 009.
- **Telemetry / APM / analytics:** ⚠️ GAP — **no Sentry, Datadog, Amplitude, PostHog, Mixpanel, GA4 or Firebase Analytics**. The only observability is `console.log/warn/error` in code.
- **CI/CD:** ⚠️ GAP — no workflows (GitHub Actions, EAS), `gitleaks`, SBOM, Snyk or Dependabot configured in the repo (`ls -la .github` does not exist; no workflow `.yml` files).
- **Tests:** Jest + `jest-expo`. 9 files in `src/__tests__/` (`scripts/reset-project.js` excluded). No E2E or data-contract tests.

**Detected data entities (model and SQL)**

- TypeScript: `FamilyMember`, `ProfileDocument`, `SchoolMenuEntry`, `SupplementEntry` (`src/types/profiles.ts`), `InventoryItem`, `Recipe`, `RecipeIngredient`, `CompatibilityResult`, `MealPlan`, `DayMeals`, `ScanResult`, `GroceryItem`, `NutritionalInfo`, `NutriScore`, `NutritionalTarget`, `AIMessage`, `OnDeviceLLMStatus` (folders under `src/types/`).
- SQLite: `inventory_items`, `recipes`, `meal_plans`, `school_menu_entries`, `scan_history`, `grocery_items`, `member_memories`, `doc_chunks`, `conversation_summaries`, technical table `migrations` (`src/db/migrations/001_initial.ts`, `011_memory_layer.ts`, `src/db/database.ts:91-97`). Tables created and later dropped: `usda_cache`, `retailer_connections` (dropped in migration 010), `app_metadata` (dropped in migration 012).
- AsyncStorage (PII and technical): `family_profiles` (partially encrypted profiles), `family_name`, `app_initialized`, `health_active_provider`, `sp_quota_cache_v2` (BFF quota response, 30s TTL), `on_device_model_first_loaded_qwen3_1_7b_q`, `on_device_embeddings_first_loaded` (cross-cutting search in `src/services/*.ts` and `src/modules/**/*.ts`).
- iOS Keychain / Android Keystore (encryption key): `nutri_master_key_v1` (`src/services/encryption.ts:10`).

**External data sources**

- OpenFoodFacts (HTTPS REST, no auth) — barcode product scans (`src/services/openFoodFacts.ts:67-88`).
- Edamam Recipe Search v2 (HTTPS, US-hosted) — Mediterranean catalog, recipes + nutrition (`src/services/edamam.ts`). The client only ever talks to the BFF (`api.nutriassistant.org/v1/edamam/*`); credentials live in Cloudflare's encrypted secret store.
- Spoonacular (HTTPS API key, US) — multi-cuisine recipes + nutrition (`src/services/spoonacular.ts:7-310`).
- TheMealDB (HTTPS API v2, `themealdb.com`) — code present but migration 009 wipes all records (`src/db/migrations/009_purge_themealdb.ts`).
- Apple HealthKit (iOS native) — steps and active calories (`src/modules/health/providers/appleHealth.ts`).
- Health Connect (Android native) — steps and active calories (`src/modules/health/providers/healthConnect.ts`).
- On-device LLM artifacts (`.pte` weights + tokenizer JSONs for Qwen 3 1.7B, ~1.2 GB total) — served by **our own Cloudflare Worker BFF** at `api.nutriassistant.org/v1/llm/qwen3-1.7b/*`, backed by an R2 bucket (`nutriassistant-llm-models`) that mirrors the upstream HuggingFace release. Downloaded on first run via `react-native-executorch` `fromCustomModel` (`src/services/onDeviceLlm.ts`, `infra/bff/src/routes/llm.ts`). Inference itself stays 100% on-device.
- ⚠️ GAP: no wearable APIs beyond HealthKit/Health Connect (Garmin, Polar, Fitbit not integrated).
- ⚠️ GAP: no calls to OpenAI/Anthropic/HuggingFace Inference or any cloud LLM (`grep -r "anthropic\|openai" src/` returns nothing). The LLM is on-device only.

**AI components**

- Generation: Qwen 3 1.7B Quantized, ~1 GB, ~32k native context, downloaded on first launch (`src/services/onDeviceLlm.ts:21-32,40-47`).
- Embeddings: all-MiniLM-L6-v2, ~28 MB, 384-dim `Float32Array` output (`src/services/embeddings.ts:19-22,33`).
- RAG: encrypted clinical-PDF chunks + cosine search (`src/services/retrieval.ts:31-55`, `src/services/memoryStore.ts:114-167`).
- Topic pre-classifier (EN+ES keyword stems) that skips inference for off-topic questions (`src/services/topicGate.ts:128-140`).
- Durable-fact extractor that post-processes each turn and proposes "memories" to the user (`src/services/factExtractor.ts:75-100`).
- Structured parser for "actions" emitted by the model (`src/services/aiActions.ts:59-86`).
- Weekly plan generator (recipe selection by LLM + algorithmic fallback, `src/modules/planner/mealPlanGenerator.ts:140-163`).
- Medical-document summarizer to inject into the prompt (`src/services/profileDocuments.ts:72-86`).

**Auth & detected encryption**

- ⚠️ GAP: **no user authentication** (Auth0, Firebase Auth, Supabase Auth). Access control is by "selected profile" + local `isSuperUser` flag (`src/modules/profiles/SelectedProfileContext.tsx`, `src/types/profiles.ts:80`).
- At-rest field-level encryption: AES-256-GCM (`src/services/encryption.ts:56-75`).
- Master key: 32 random bytes, persisted in Keychain/Keystore via `expo-secure-store` (`src/services/encryption.ts:33-48`).
- ⚠️ GAP: **no TLS pinning, no mTLS** (all API calls use the platform's default TLS).
- ⚠️ GAP: **no master-key rotation**.

**Observability**

- ⚠️ Severe GAP. Only `console.log/warn/error`. No APM SDK, no metrics, no audit logs, no distributed traces, no alerts, no dashboards. The only "alert" surfaced to the user is `expo-notifications` for the on-device model download (`src/services/aiNotifications.ts`).

**Data governance**

- ⚠️ GAP: no catalog, glossary, lineage, data contracts, or data-quality tests (Great Expectations, dbt) in the repo. Implicit domain rules do exist in code (e.g. the 14 EU allergens in `src/seed/allergen-rules.ts`, undocumented retention rules).

---

## Section 0 — Executive Summary

**Current state:** mobile prototype with a radical local-first architecture. All PII, Art. 9 health data, clinical-document embeddings and LLM inference live on the user's device. The only backend of our own is a thin Cloudflare Worker BFF (`api.nutriassistant.org`) that proxies third-party catalog APIs (OpenFoodFacts, Edamam, Spoonacular) so their credentials never ship in the bundle, and mirrors the on-device LLM artifacts on R2 for a stable EU edge POP. No tracking, no account, no user data in the BFF. Field-level encryption of sensitive fields (`aboutMeNotes`, `conditions`, memories, embeddings, PDF chunks) uses AES-GCM-256 with a 256-bit key in Keychain/Keystore. The initial download (~1.2 GB of Qwen 3 from R2 + 28 MB of MiniLM from HuggingFace) is the only model traffic. The recipe catalog is enriched with the three external APIs whose credentials live exclusively in Cloudflare's encrypted secret store ([§3.6](./03-security-encryption.md#36-secrets-management-in-the-repo)).

### Summary table

| Axis | Status | Technology / Components | GDPR posture |
|---|---|---|---|
| Stack | ✅ | Expo SDK 55, React Native 0.83.6, TypeScript 5.9, expo-sqlite, AsyncStorage, expo-secure-store | n/a |
| Primary storage | ✅ | Local SQLite + AsyncStorage + iOS Keychain/Android Keystore + FileSystem (`docs/`, `avatars/`) | 🟡 (partial encryption — critical fields only) |
| Key store | ✅ | iOS Keychain / Android Keystore (hardware-backed when available) | 🟡 (no rotation) |
| External providers | ✅ | OpenFoodFacts, Edamam, Spoonacular **all via BFF**; LLM artifacts via Cloudflare R2 (mirror of HuggingFace upstream); MiniLM embeddings model still from HuggingFace direct; Apple Health, Health Connect | 🔴 (no DPIA, no SCC, no TIA) |
| AI model | ✅ | **100% on-device**: Qwen 3 1.7B Quantized (LLM) + all-MiniLM-L6-v2 (embeddings) | 🟢 (privacy-by-design) |
| Field-level encryption at rest | ✅ | AES-256-GCM `@noble/ciphers`, 96-bit nonce, 128-bit tag | 🟡 (does not cover all columns) |
| Encryption in transit | ✅ | OS-default TLS 1.2/1.3; no pinning | 🟡 |
| User authentication | 🔴 | ⚠️ GAP — no login, no MFA, no federation; local "profile selection" | 🔴 |
| Telemetry / APM | 🟡 | Central logger with PII scrubbing (`src/utils/logger.ts`) wraps every call site; encrypted local audit log persisted. **DEFERRED**: Sentry/Aptabase hosting. | 🟡 |
| Data governance | 🟡 | Catalogs consolidated in `src/domain/masterData.ts` with coherence test; ROPA in `docs/legal/ROPA.md`; incident-response runbook in `docs/runbooks/`. Still missing: data-quality observability dashboard. | 🟡 |
| GDPR rights in UI | ✅ | Art. 15 export → zip with decrypted JSONs + PDFs (`src/services/userDataExport.ts`); Art. 17 erasure → atomic wipe (`src/services/dataErasure.ts`); Art. 7.3 consent revocation → Settings toggles | 🟢 |
| Granular consent (Art. 9.2.a) | ✅ | 3 toggles (`health`, `ai`, `documents`) in `src/modules/consent/ConsentContext.tsx`; captured at onboarding, revocable in Settings | 🟢 |
| Parental gate (<14) | ✅ | Required checkbox in `app/onboarding.tsx` member-health step; `parental_consent_granted` audit event with `policyVersion` | 🟢 |
| Audit log (Art. 30/33) | ✅ | Migration 014 + `src/services/auditLog.ts`; encrypted payloads, plaintext event metadata for 72h enumeration; "My activity" surface in `app/audit-log.tsx` | 🟢 |
| Medical disclaimer (Art. 22) | ✅ | Non-dismissible banner in `src/components/layout/AIAssistant.tsx`, EN+ES | 🟢 |
| Medical RAG | ✅ | Encrypted clinical-PDF chunks, cosine retrieval, top-K 2, threshold 0.4 | 🟢 |
| Automated decisions (Art. 22) | 🟡 | Suggestions, not decisions; missing explicit notice + granular opt-out in UI | 🟡 |
| Data of minors | 🟡 | Age gate on AI chat (≥18, `src/modules/ai-engine/aiAccess.ts:13-22`); ⚠️ no parental verification for child profiles | 🟡 |

### Critical findings — status after the 5-sprint engineering pass (commit `aaa3179`)

1. **✅ Secrets in public bundle (RESOLVED).** Historically `EXPO_PUBLIC_FATSECRET_*` and `EXPO_PUBLIC_SPOONACULAR_API_KEY` were compiled into the binary. As of commit `1647aac` all three upstreams (OFF, Edamam, Spoonacular) are reached only through the BFF at `api.nutriassistant.org`. The bundle holds only `EXPO_PUBLIC_BFF_BASE_URL`, a public URL.
2. **✅ Full data deletion (RESOLVED).** `src/services/dataErasure.ts` performs an atomic wipe of 12 SQLite tables, 16 AsyncStorage keys, the FileSystem subtrees (`profile-documents/`, `avatars/`, model cache), and the Keychain master key. Settings → "Delete all my data" runs it after a two-step confirmation. Audit log records `erasure_started` / `erasure_completed`. Art. 17 implemented.
3. **✅ Medical disclaimer (RESOLVED).** Persistent non-dismissible banner under the chat header in `src/components/layout/AIAssistant.tsx`, EN+ES, fires on every reopen. Art. 22 transparency notice in place.
4. **✅ Granular consent Art. 9.2.a (RESOLVED).** `src/modules/consent/ConsentContext.tsx` exposes three toggles (`health`, `ai`, `documents`), captured in the onboarding flow and revocable from Settings (Art. 7.3). Every change writes a `consent_granted` / `consent_revoked` audit event with `policyVersion`.
5. **🟡 Observability — partial.** Logger central with PII scrubbing now wraps every `console.*` call (55 migrated across 25 files). Encrypted local audit log persisted via migration 014. **DEFERRED**: Sentry self-hosted EU + Aptabase telemetry (both require ~€30/mo of external spend).
6. **❌ DPIA + DPO — deferred.** Art. 9 health-data processing still requires both. External consultancy spend (~€5-15k DPIA, €500-1500/mo DPO) — not engineering work; the technical inputs (ROPA, runbook, Model Card) are ready in `docs/legal/` and `docs/runbooks/`.

### Top recommendations — what's left

1. **Contract a DPO + commission the DPIA.** Engineering deliverables ready in `docs/legal/ROPA.md`, `docs/MODEL_CARD.md`, `docs/runbooks/INCIDENT_RESPONSE.md`. External legal/consulting spend, no further code work.
2. **Get the privacy policy reviewed and published** to a public URL (App Store requirement). The placeholder text in `assets/legal/privacy-policy-v1.{en,es}.md` is shipped in-app via `app/legal/privacy.tsx`.
3. **Wire Sentry self-hosted EU + Aptabase** once the budget is approved. The logger hook in `src/utils/logger.ts` is one-line drop-in.
4. **Sign SCCs with Edamam and Spoonacular** (Schrems II). Currently a tolerated risk for the España-only launch.
5. **Fill the App Store Privacy Nutrition Labels + Play Data Safety forms** at submission time using the field-by-field guide in `docs/store-readiness/privacy-labels.md`.

**Prioritized recommendations:** see [§9](./09-improvement-plan.md) — full table of 28 improvements ordered by severity / effort / impact.
