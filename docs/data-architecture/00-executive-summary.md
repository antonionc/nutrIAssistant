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
- **External APIs:** three nutrition/recipe catalog providers (see [§2.2](./02-data-model-architecture.md#22-data-source-classification)): **OpenFoodFacts** (no auth, `src/services/openFoodFacts.ts:3`), **Edamam** Recipe Search v2 (`app_id` + `app_key` held server-side in the Cloudflare BFF, never in the bundle, `src/services/edamam.ts`), **Spoonacular** (API key still in bundle pending BFF migration, `src/services/spoonacular.ts:7`). FatSecret was removed in migration 013; TheMealDB earlier in migration 009.
- **Telemetry / APM / analytics:** ⚠️ GAP — **no Sentry, Datadog, Amplitude, PostHog, Mixpanel, GA4 or Firebase Analytics**. The only observability is `console.log/warn/error` in code.
- **CI/CD:** ⚠️ GAP — no workflows (GitHub Actions, EAS), `gitleaks`, SBOM, Snyk or Dependabot configured in the repo (`ls -la .github` does not exist; no workflow `.yml` files).
- **Tests:** Jest + `jest-expo`. 9 files in `src/__tests__/` (`scripts/reset-project.js` excluded). No E2E or data-contract tests.

**Detected data entities (model and SQL)**

- TypeScript: `FamilyMember`, `ProfileDocument`, `SchoolMenuEntry`, `SupplementEntry` (`src/types/profiles.ts`), `InventoryItem`, `Recipe`, `RecipeIngredient`, `CompatibilityResult`, `MealPlan`, `DayMeals`, `ScanResult`, `GroceryItem`, `NutritionalInfo`, `NutriScore`, `NutritionalTarget`, `AIMessage`, `OnDeviceLLMStatus` (folders under `src/types/`).
- SQLite: `inventory_items`, `recipes`, `meal_plans`, `school_menu_entries`, `scan_history`, `grocery_items`, `member_memories`, `doc_chunks`, `conversation_summaries`, technical table `migrations` (`src/db/migrations/001_initial.ts`, `011_memory_layer.ts`, `src/db/database.ts:91-97`). Tables created and later dropped: `usda_cache`, `retailer_connections` (dropped in migration 010), `app_metadata` (dropped in migration 012).
- AsyncStorage (PII and technical): `family_profiles` (partially encrypted profiles), `family_name`, `app_initialized`, `health_active_provider`, `fs_token`, `fs_token_expiry`, `sp_daily_calls`, `on_device_model_first_loaded_qwen3_1_7b_q`, `on_device_embeddings_first_loaded` (cross-cutting search in `src/services/*.ts` and `src/modules/**/*.ts`).
- iOS Keychain / Android Keystore (encryption key): `nutri_master_key_v1` (`src/services/encryption.ts:10`).

**External data sources**

- OpenFoodFacts (HTTPS REST, no auth) — barcode product scans (`src/services/openFoodFacts.ts:67-88`).
- Edamam Recipe Search v2 (HTTPS, US-hosted) — Mediterranean catalog, recipes + nutrition (`src/services/edamam.ts`). The client only ever talks to the BFF (`api.nutriassistant.org/v1/edamam/*`); credentials live in Cloudflare's encrypted secret store.
- Spoonacular (HTTPS API key, US) — multi-cuisine recipes + nutrition (`src/services/spoonacular.ts:7-310`).
- TheMealDB (HTTPS API v2, `themealdb.com`) — code present but migration 009 wipes all records (`src/db/migrations/009_purge_themealdb.ts`).
- Apple HealthKit (iOS native) — steps and active calories (`src/modules/health/providers/appleHealth.ts`).
- Health Connect (Android native) — steps and active calories (`src/modules/health/providers/healthConnect.ts`).
- HuggingFace CDN (`.pte` models and tokenizers) — downloaded on first run via `react-native-executorch` (`src/services/onDeviceLlm.ts:110-118`, `app/_layout.tsx:18`).
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

**Current state:** mobile prototype with a radical local-first architecture. All PII, Art. 9 health data, clinical-document embeddings and LLM inference live on the user's device. There is no backend of our own, no tracking, no account. Field-level encryption of sensitive fields (`aboutMeNotes`, `conditions`, memories, embeddings, PDF chunks) uses AES-GCM-256 with a 256-bit key in Keychain/Keystore. The initial download (~1 GB of Qwen 3 + 28 MB of MiniLM) hits the HuggingFace CDN. The recipe catalog is enriched with three external APIs whose credentials ship in the bundle as `EXPO_PUBLIC_*` (identified risk, see [§3.6](./03-security-encryption.md#36-secrets-management-in-the-repo)).

### Summary table

| Axis | Status | Technology / Components | GDPR posture |
|---|---|---|---|
| Stack | ✅ | Expo SDK 55, React Native 0.83.6, TypeScript 5.9, expo-sqlite, AsyncStorage, expo-secure-store | n/a |
| Primary storage | ✅ | Local SQLite + AsyncStorage + iOS Keychain/Android Keystore + FileSystem (`docs/`, `avatars/`) | 🟡 (partial encryption — critical fields only) |
| Key store | ✅ | iOS Keychain / Android Keystore (hardware-backed when available) | 🟡 (no rotation) |
| External providers | ✅ | OpenFoodFacts, Edamam (via BFF), Spoonacular (US), HuggingFace CDN, Apple Health, Health Connect | 🔴 (no DPIA, no SCC, no TIA) |
| AI model | ✅ | **100% on-device**: Qwen 3 1.7B Quantized (LLM) + all-MiniLM-L6-v2 (embeddings) | 🟢 (privacy-by-design) |
| Field-level encryption at rest | ✅ | AES-256-GCM `@noble/ciphers`, 96-bit nonce, 128-bit tag | 🟡 (does not cover all columns) |
| Encryption in transit | ✅ | OS-default TLS 1.2/1.3; no pinning | 🟡 |
| User authentication | 🔴 | ⚠️ GAP — no login, no MFA, no federation; local "profile selection" | 🔴 |
| Telemetry / APM | 🔴 | ⚠️ GAP — `console.*` only | 🔴 (cannot detect a breach without observability) |
| Data governance | 🔴 | ⚠️ GAP — no catalog, glossary, lineage, contracts, quality tests | 🔴 |
| GDPR rights in UI | 🟡 | Markdown + JSON export ✅; full erasure ⚠️ stub (not implemented, `app/settings.tsx:516,520`) | 🟡 |
| Medical RAG | ✅ | Encrypted clinical-PDF chunks, cosine retrieval, top-K 2, threshold 0.4 | 🟢 |
| Automated decisions (Art. 22) | 🟡 | Suggestions, not decisions; missing explicit notice + granular opt-out in UI | 🟡 |
| Data of minors | 🟡 | Age gate on AI chat (≥18, `src/modules/ai-engine/aiAccess.ts:13-22`); ⚠️ no parental verification for child profiles | 🟡 |

### Critical findings (top 5)

1. **🟡 Secrets partially still in bundle.** `EXPO_PUBLIC_SPOONACULAR_API_KEY` is still compiled into the binary (`src/services/spoonacular.ts:7`). Anyone can extract it with `strings` from the IPA/APK. Spoonacular migration to the existing BFF (`api.nutriassistant.org`) is the pending mitigation. Edamam never shipped credentials in any binary (everything goes through the BFF). FatSecret was removed entirely in migration 013.
2. **🔴 Total lack of observability.** No APM (Sentry/Datadog), no product analytics, no audit logs. Cannot satisfy GDPR Art. 33–34 (breach notification) without traceability.
3. **🔴 Full data deletion not implemented.** The "Delete all data" button in `app/settings.tsx:517-524` shows an Alert, but the `onPress: () => {}` handler is empty. There is an explicit `// TODO: implement full data deletion` (`app/settings.tsx:516`). Blocks the right to erasure under Art. 17.
4. **🟡 AI usage and limitations notice missing.** No in-app "not medical advice" disclaimer. The model prompt offers guidance based on conditions (hypertension, celiac, diabetes 1/2, etc. — `src/services/prompts/system.ts:17-26`) without explicit Art. 9 consent on legal basis.
5. **🟡 No DPIA despite Art. 9 health-data processing.** The `conditions` field is encrypted, but the systematic large-scale processing of health data requires a DPIA before production.

### Top recommendations

1. **Complete BFF migration** for Spoonacular and OpenFoodFacts (Edamam is already routed through the BFF; only `EXPO_PUBLIC_SPOONACULAR_API_KEY` remains in the bundle). The BFF runs on Cloudflare Workers at `api.nutriassistant.org`, code in `infra/bff/`.
2. **Implement full deletion**: wipe SQLite + AsyncStorage + FileSystem `documentDirectory/profile-documents/` + the Keychain key `nutri_master_key_v1` + AsyncStorage model flag + `app_initialized`. Same code path for the "right to be forgotten".
3. **Add the Sentry SDK** (or equivalent) with a `beforeSend` that strips PII and `enc:v1:` fields before sending. Critical for Art. 33 (breach notification within 72h).
4. **Publish a privacy policy** and an in-app medical disclaimer, with explicit Art. 9.2.a consent before enabling the AI chat. Today the gate is age-based (`≥18`) and not by informed consent.
5. **Commission an external DPIA** (audit) and publish Privacy Nutrition Labels + Data Safety Section consistent with the code.

**Prioritized recommendations:** see [§9](./09-improvement-plan.md) — full table of 28 improvements ordered by severity / effort / impact.
