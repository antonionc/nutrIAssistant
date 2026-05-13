# NutrIAssistant

Family nutrition assistant for iOS and Android. Local-first architecture: every PII, health data, clinical document and LLM inference lives on the user's device.

A thin Cloudflare Worker BFF at `api.nutriassistant.org` proxies third-party catalog APIs (OpenFoodFacts, Edamam, Spoonacular) and mirrors the on-device LLM artifacts from R2 — **no third-party API key ever ships in the mobile bundle**.

## Stack

- **Client:** React Native 0.83.6 + React 19.2, Expo SDK 55, TypeScript 5.9. Hermes + New Architecture + experimental React Compiler enabled.
- **Routing:** `expo-router` with typed routes.
- **Storage:** SQLite (`expo-sqlite`, 12 migrations, WAL, FK on) + AsyncStorage + FileSystem for PDFs/avatars + iOS Keychain / Android Keystore for the AES-256-GCM master key.
- **On-device AI:** `react-native-executorch` running Qwen 3 1.7B Quantized (~1 GB `.pte`) for chat and all-MiniLM-L6-v2 (~28 MB) for embeddings. Model artifacts are mirrored on Cloudflare R2 and downloaded through our BFF.
- **Health integrations:** Apple HealthKit (iOS) and Google Health Connect (Android), via defensive `require`.
- **Camera & PDFs:** `expo-camera` for barcode scanning, custom Expo native module `expo-pdf-text` for clinical-PDF text extraction.
- **BFF:** Cloudflare Workers on Hono, KV (rate limit / quota) + R2 (LLM mirror). Code in `infra/bff/`.

## Get started

```bash
npm install
cp .env.example .env       # only EXPO_PUBLIC_BFF_BASE_URL — safe to bundle
npx expo start
```

For a development build (recommended for testing the on-device LLM, which Expo Go cannot host):

```bash
npm run ios       # or
npm run android
```

## Tests

```bash
npm test                 # full Jest suite (~14 suites, ~183 tests)
npm run test:watch
npm run test:coverage
```

## Documentation

| Where | What's inside |
|---|---|
| [`docs/data-architecture/`](./docs/data-architecture/) | 13-file technical doc set — executive summary, data lifecycle, data model, security & encryption, AI architecture, privacy model, governance, observability, production readiness, improvement plan, appendices (ADRs), extended diagrams |
| [`infra/bff/README.md`](./infra/bff/README.md) | Cloudflare Worker BFF — architecture, endpoints, one-time setup, secrets policy, credential rotation runbook, on-device LLM mirroring procedure |

## Layout

```
app/                    Expo Router screens (tabs, recipe detail, scanner, settings, onboarding…)
src/
  components/           Reusable UI (cards, charts, badges, layout — MarkdownText, LLMLoadingBar, AIAssistant…)
  modules/              Domain modules with their own React contexts (profiles, planner, inventory, groceries, recipes, ai-engine, health)
  services/             Cross-cutting services (BFF client, on-device LLM, embeddings, retrieval, prompts, encryption, providers…)
  db/                   SQLite migration runner + 12 migrations
  i18n/                 English + Spanish translation tables (mandatory routing for every new string)
  theme/                Design tokens + theme context
  types/                Shared TypeScript types
infra/bff/              Cloudflare Worker BFF source
modules/expo-pdf-text/  Custom Expo native module (Swift + Kotlin) for PDF text extraction
```

## Privacy & compliance

NutrIAssistant processes GDPR Art. 9 health data (medical conditions, lab reports, dietary restrictions) under a privacy-by-design posture: all inference and analysis runs on-device, sensitive fields use AES-256-GCM column-level encryption with a 256-bit key stored in the secure enclave, and the only cloud traffic is non-PII catalog lookups via our own EU-hosted Worker. Known compliance gaps (full deletion not yet implemented, no DPIA on file, missing medical disclaimer) are tracked in [`docs/data-architecture/09-improvement-plan.md`](./docs/data-architecture/09-improvement-plan.md).
