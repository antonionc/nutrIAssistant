# NutrIAssistant — Project Context

Full detail: `nutriassistant-product-brief-v3-en.md` (product), `nutriassistant-mvp-spec-v3-en.md` (technical).

## What it is

Privacy-first nutrition app for Spanish/English families (3–6 members). Multi-profile health registry, zero-waste pantry, weekly meal planner respecting allergens + school menu, recipe catalogue, barcode scanner, auto-grocery list, on-device NutriBot assistant scoped to food/nutrition/health with a hard under-18 lock.

## Non-negotiables

1. **Local-only AI.** No cloud LLM SDKs. On-device LLM is intrinsic — no "disable AI" toggle.
2. **AI age gate.** Profile <18 → unreachable. 3 layers: FAB, `AIAssistantHost`, `AIContext.sendMessage`. Policy `src/modules/ai-engine/aiAccess.ts`. Hide-by-default on null/missing/malformed/future DOB.
3. **Topic gate.** Off-scope → localized canned refusal, no model call.
4. **No CoT leakage.** Every system prompt starts `/no_think`. Stream tokens through `stripThinkingBlock()` per token.
5. **Encryption-at-rest.** AES-GCM-256 via `@noble/ciphers`. Master key in `expo-secure-store` (`nutri_master_key_v1`). `ensureKey()` runs **before** `loadProfiles()`. Sentinel: `enc:v1:` prefix.
6. **Locale-coherent.** `expo-localization` at boot drives UI, AI prompts, refusals, voice/TTS, dates. Mixed-language = regression.
7. **Family = unit.** Every screen reasons about N members.
8. **User-confirmed memory.** Facts proposed via `pendingFacts` banner. Never silent persistence.
9. **i18n mandatory.** Every UI string through `src/i18n` (`en.ts` + `es.ts`); `_KeyGuard` enforces parity.

## Stack

- Expo SDK 55 + RN 0.83.6 + React 19.2 + TS ~5.9 (strict, typed routes)
- Expo Router 6 · React Context one-per-domain (no Redux/Zustand)
- SQLite (WAL, FK on) + AsyncStorage + FileSystem
- Crypto: `@noble/ciphers`, `expo-secure-store`, `expo-crypto`
- LLM: `react-native-executorch` — **Qwen 3 1.7B Quantized** (~1 GB, ~32k ctx)
- Embeddings: **MiniLM L6 v2** (~28 MB, 384-dim)
- Native in-tree: `modules/liquid-glass/` (iOS 26 SwiftUI), `modules/expo-pdf-text/` (PDFKit/PdfBox)
- Tests: `jest-expo`, 370 / 26 suites · iOS min 18.1 · Android predictive back **disabled**

## Commands

```bash
npm install && npx pod-install         # setup
npx expo run:ios | run:android         # full native build
npx expo start --dev-client            # daily dev
npm test                               # full Jest suite (includes the AI testbed)
npm run testbed                        # AI-assistant capability report
eas build -p ios|android --profile production
```

## AI testbed (two layers)

1. **Model-free harness** — `src/__tests__/ai-testbed/` (Jest, <1s, CI-safe).
   Security harness, memory & RAG ranking, recipe specialization, prompt
   assembly, eval scorer. Run with `npm run testbed`.
2. **On-device behavioural eval** — `src/services/aiEval/` + the dev-only
   screen `app/dev/ai-eval.tsx` (Settings → "AI behavioural eval (dev)" in a
   dev build). Runs the **real** pipeline (`AIContext.sendMessage` → Qwen 3)
   over a golden set of ~18 cases, scores each reply, shows pass/fail +
   latency + the full reply for human review.

**Claude must suggest re-running `npm run testbed` after any deep change to the
AI assistant architecture** — edits to `onDeviceLlm.ts`, `embeddings.ts`,
`retrieval.ts`, `memoryStore.ts`, `topicGate.ts`, `prompts/system.ts`,
`aiActions.ts`, `factExtractor.ts`, `modules/ai-engine/*`, or a migration
touching `member_memories` / `doc_chunks`. For changes that affect generated
text (prompt/system, model swap, fact extractor) **also** recommend the
on-device eval before shipping. When a misclassification or regression slips
through, add the case to the relevant corpus, not just the code.

## What Claude must NEVER do

- ❌ Import any cloud LLM SDK or add cloud-LLM env vars.
- ❌ Expose "disable AI" / "delete model" toggles.
- ❌ Bypass `isAIAccessibleForMember()` — minors must NEVER reach the assistant.
- ❌ Render LLM output without `stripThinkingBlock`.
- ❌ Persist facts without `pendingFacts` confirmation.
- ❌ Hardcode language strings — always `tr.*`.
- ❌ Edit/delete shipped migrations 001–016 — add a new one.
- ❌ Skip `ensureKey()` or read profiles before it resolves.
- ❌ **Write** to Apple Health / Health Connect (read-only).
- ❌ Mix Spanish + English in one AI reply.
- ❌ Enable Android predictive back gesture.
- ❌ Telemetry of prompts/replies/memories. Log decrypted values.

## Conventions

- **Layout:** routes `app/`; domain `src/modules/{domain}/` (Context + DB + utils); services `src/services/`; UI `src/components/`; i18n `src/i18n/`; native `modules/`; tests `src/__tests__/` mirror source.
- **Naming:** `camelCase.ts` utils, `PascalCase.tsx` components, `snake_case` tables + AsyncStorage keys, migrations `NNN_short_description.ts` (forward-only).
- **Migrations:** forward-only, immutable, idempotent. SQL wrapped in `withTransactionAsync`; fn-migrations handle txns manually. `tolerateDuplicate` only matches `/duplicate column name/i`.
- **AI prompts:** locale-aware, `/no_think`, hard cap **4500 chars** (slice from end, preserve guardrail + active member). Single in-flight LLM lock (10 s).
- **TS:** no `any`; prefer `unknown` + narrowing. Types in `src/types/`.
- **Jest:** `@noble/ciphers` in `transformIgnorePatterns`. Mock `expo-localization` for locale-sensitive suites.

## Project map

| Concern | Path |
|---|---|
| Root bootstrap | `app/_layout.tsx` |
| DB runner + invariants | `src/db/database.ts` |
| Migrations | `src/db/migrations/` |
| Encryption | `src/services/encryption.ts` |
| AI engine / age gate | `src/modules/ai-engine/{AIContext.tsx,aiAccess.ts}` |
| Topic gate / fact extractor | `src/services/{topicGate,factExtractor}.ts` |
| Memory + retrieval | `src/services/{memoryStore,retrieval}.ts` |
| Prompt builder | `src/services/prompts/system.ts` |
| `<think>` stripper + actions | `src/services/aiActions.ts` |
| PDF summary + indexing | `src/services/profileDocuments.ts` |
| AI testbed + runner | `src/__tests__/ai-testbed/`, `scripts/ai-testbed.mjs` |
| On-device behavioural eval | `src/services/aiEval/`, `app/dev/ai-eval.tsx` |
