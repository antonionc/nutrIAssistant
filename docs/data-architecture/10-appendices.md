# 10 — Appendices

## 10.1. Glossary

| Term | Definition | Origin / reference |
|---|---|---|
| **AS-IS / TO-BE** | Current state / target state | Course terminology |
| **GDPR Art. 9** | Article of the GDPR on special categories of personal data (health, religion, ethnicity, etc.) | Regulation (EU) 2016/679 |
| **GDPR Art. 22** | Right not to be subject to automated decisions | Same |
| **GDPR Art. 33** | Breach notification to the authority within 72h | Same |
| **GDPR Art. 35** | DPIA mandatory for high-risk processing | Same |
| **BFF (Backend For Frontend)** | Lightweight server between client and external providers; manages secrets and rate limits | — |
| **Bronze / Silver / Gold (medallion)** | Data-lake processing layers from raw to curated | Databricks |
| **CCPA / CPRA** | California Consumer Privacy Act / Privacy Rights Act | — |
| **Art. 9.2.a consent** | Explicit consent required for special-category data | GDPR |
| **Cross-reactivity** | Allergen cross-reactivity (e.g. crustaceans ↔ molluscs) | `src/seed/allergen-rules.ts` |
| **DAMA-DMBOK** | Data Management Body of Knowledge; the "DAMA wheel" with 11 areas | DAMA International |
| **Data Mesh** | Architectural pattern that decentralizes data ownership by domain | Zhamak Dehghani |
| **DPDP Act** | Digital Personal Data Protection Act (India, 2023) | — |
| **DPIA** | Data Protection Impact Assessment (GDPR Art. 35) | GDPR |
| **DPO** | Data Protection Officer | GDPR |
| **DSR / DSAR** | Data Subject (Access) Request | GDPR |
| **EU-14 allergens** | The 14 allergens with mandatory declaration in the EU | Reg. (EU) 1169/2011 |
| **HuggingFace .pte file** | PyTorch ExecuTorch model format | Meta AI |
| **Idempotency** | Property of an operation that can be repeated without changing the result | — |
| **Kappa architecture** | Streaming-only processing, with replay from a commit log | Jay Kreps |
| **KMS** | Key Management System | AWS / GCP / in-house |
| **LGPD** | Lei Geral de Proteção de Dados (Brazil) | — |
| **LOPDGDD** | Spain's Organic Law 3/2018 on Data Protection; BOE-A-2018-16673 | BOE |
| **MASVS** | Mobile Application Security Verification Standard | OWASP |
| **PIPL** | Personal Information Protection Law (China) | — |
| **PII** | Personally Identifiable Information | — |
| **PRAGMA WAL** | SQLite Write-Ahead Logging | SQLite docs |
| **Privacy by design / default** | Principles of GDPR Art. 25 | GDPR |
| **Pseudonymization** | Substitution of a direct identifier by a pseudonym (minimization technique, Art. 25) | GDPR |
| **ROPA** | Records of Processing Activities (GDPR Art. 30) | GDPR |
| **RBAC / ABAC** | Role-Based / Attribute-Based Access Control | — |
| **Refusal message** | Canned reply when the topic classifier marks a query off-topic | `src/services/topicGate.ts:144-147` |
| **SBOM (CycloneDX/SPDX)** | Software Bill of Materials | OWASP / Linux Foundation |
| **Schrems II** | CJEU C-311/18 ruling invalidating the EU-US Privacy Shield | CJEU |
| **SCC** | Standard Contractual Clauses for international transfers | European Commission |
| **SLI / SLO / SLA** | Service Level Indicator / Objective / Agreement | Google SRE |
| **STRIDE** | Microsoft threat model (Spoofing, Tampering, Repudiation, Info Disclosure, DoS, Elevation of Privilege) | Microsoft SDL |
| **TIA** | Transfer Impact Assessment (Schrems II) | — |
| **TTFB (time-to-first-byte / first-token)** | Latency until the first byte/token of the response | — |
| **WAL (Write-Ahead Logging)** | SQLite journal mode (`PRAGMA journal_mode = WAL;`) | `src/db/database.ts:54` |

## 10.2. Section ↔ course-curriculum mapping

> ⚠️ The course PDFs were not included in the repository. Slide titles are cited from memory of a standard Data & AI master's program (generic references to "The data lifecycle I/II/III"). The instructor should be able to map each section of this document to the actual slides.

| Section of this document | Likely course slide / module |
|---|---|
| §1 Data lifecycle (5 canonical phases) | *"The data lifecycle I — Ingestion, Transformation, Analytics, Exploitation"* |
| §1 Cross-cutting layers | *"The data lifecycle II — Security, Monitoring, Governance"* |
| §2.2 Passive/active access mode + structured/semi/unstructured | *"The data lifecycle II — Source classification"* |
| §2.3 Ingestion modes (batch / streaming / real-time) | Same |
| §2.4 SQL/NoSQL/Lake/Warehouse storage | *"Storage I — Database types"* |
| §2.5 Medallion architecture | *"Storage II — Layered data lake"* |
| §2.7 Lambda vs Kappa vs Data Mesh | *"Processing architectures"* |
| §3.1-3.4 The 4 policies (Encryption, Keys, Users, Observability) | *"Security I-II — The four policies"* |
| §3.5 STRIDE | *"Threat modeling"* |
| §4 Generative AI, RAG, MLOps | *"AI in modern data architectures"* |
| §4.6 AI Governance | *"AI Governance and DAMA AI Governance"* |
| §5 GDPR: principles, rights, 8 steps | *"The data lifecycle III — GDPR"* |
| §5.6 Schrems II | *"International transfers post Schrems II"* |
| §6 DAMA wheel (glossary, lineage, master data, quality, metrics, roles) | *"Data governance — DAMA"* |
| §6.5 Three layers of metrics (business, data, processes) | *"Governance metrics"* |
| §8 AS-IS vs TO-BE, top-down/bottom-up cases, cost vs value | *"Data strategy in organizations"* |
| §8.1 Data-driven maturity (resistant→aware→guide→savvy→driven) — implicit in the TO-BE plan | *"Maturity model"* |

## 10.3. Bibliographic references

- **GDPR**: Regulation (EU) 2016/679 of the European Parliament and the Council, 27 April 2016. https://eur-lex.europa.eu/eli/reg/2016/679/oj
- **LOPDGDD**: Spanish Organic Law 3/2018, of 5 December, on the Protection of Personal Data and the safeguarding of digital rights. **BOE-A-2018-16673**. https://www.boe.es/eli/es/lo/2018/12/05/3
- **Regulation (EU) 1169/2011**: Food information provided to the consumer (EU-14 allergens).
- **AEPD — GDPR compliance guide**. https://www.aepd.es
- **AEPD — AI and GDPR guide**. https://www.aepd.es/guias
- **OWASP MASVS (Mobile Application Security Verification Standard) v2.0**. https://mas.owasp.org/MASVS/
- **OWASP MASTG (Mobile Security Testing Guide)**. https://mas.owasp.org/MASTG/
- **Apple App Store Review Guidelines**. https://developer.apple.com/app-store/review/guidelines/
- **Apple — App Privacy Details on the App Store**. https://developer.apple.com/app-store/app-privacy-details/
- **Apple — HealthKit Programming Guide**.
- **Google Play — Data Safety Section help**. https://support.google.com/googleplay/android-developer/answer/10787469
- **Google Play Policies — AI-Generated Content**. https://support.google.com/googleplay/android-developer/answer/13985936
- **Google — Health Connect docs**. https://developer.android.com/health-and-fitness/guides/health-connect
- **DAMA-DMBOK 2nd ed.** — *Data Management Body of Knowledge*.
- **NIST SP 800-53r5** — Security and Privacy Controls.
- **NIST AI Risk Management Framework (AI RMF 1.0)**.
- **CNIL** — *Recommandations sur les transferts hors UE (Schrems II)*.
- **CJEU C-311/18** *Data Protection Commissioner v. Facebook Ireland Ltd and Maximillian Schrems* (Schrems II).
- **Anthropic Constitutional AI** (conceptual reference on AI safety).
- **Qwen 3 Model Card** — Alibaba. https://huggingface.co/Qwen
- **ExecuTorch** — PyTorch. https://pytorch.org/executorch/
- **all-MiniLM-L6-v2 Model Card**. https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- **OpenFoodFacts API v2** — https://wiki.openfoodfacts.org/API
- **Edamam Recipe Search API v2** — https://developer.edamam.com/edamam-docs-recipe-api
- **Spoonacular Food API** — https://spoonacular.com/food-api
- **Expo SDK 55 Documentation** — https://docs.expo.dev/
- **React Native 0.83 Release Notes** — https://reactnative.dev/blog
- **EU AI Act** — Regulation (EU) 2024/1689. Progressively applicable; health-oriented AI systems may qualify as "high risk".

## 10.4. Architectural Decision Records (ADRs)

### ADR-001: Local-first architecture and prohibition of cloud AI

**Status**: Adopted.
**Date**: 2026-04-15 (commit `125606c` "Implement on-device Llama LLM").
**Context**: the app processes Art. 9 health data. Any transfer to a US AI provider (OpenAI, Anthropic) would require SCC + TIA + specific consent + recurring cost.
**Decision**: all inference runs on the device. No cloud LLM provider is called (`grep` confirmed).
**Positive consequences**: absolute privacy by design; €0 inference cost; commercial differentiator.
**Negative consequences**: model capped at ~1.7B params (vs state-of-the-art 70B+); ~1 GB initial download; response quality below Claude/GPT-4.
**Evidence**: `src/services/onDeviceLlm.ts:7-9`, project `local_ai_architecture.md` memory.

### ADR-002: Field-level encryption (not page-level)

**Status**: Adopted.
**Date**: 2026-05-05 (encryption module).
**Context**: alternatives were: (a) SQLCipher (page-level encryption); (b) selective field-level encryption; (c) none.
**Decision**: (b) selectively encrypt critical fields with the `enc:v1:` sentinel + AES-GCM-256.
**Positive consequences**: zero modification to the SQLite runtime; allows efficient queries and `COUNT(*)`; backward-compatible with legacy plaintext.
**Negative consequences**: partial coverage — does not cover all Art. 9 columns today; a SQLite dump exposes part of the PII.
**Evidence**: `src/services/encryption.ts`, `src/modules/profiles/profileStorage.ts:13-37`.

### ADR-003: Forward-only, idempotent, transactional migrations

**Status**: Adopted.
**Date**: 2026-04-15 (initial commit).
**Context**: the schema will evolve and users cannot wait for the next release to use the app after a migration.
**Decision**: every migration is forward-only, idempotent, and wrapped in a transaction except when it needs `PRAGMA` (in which case it is a `fn` migration).
**Positive consequences**: robust against re-runs; recovery from corrupted `migrations` tables; no "downgrade" support simplifies testing.
**Negative consequences**: errors require a corrective new migration (no hot-fix to a previous one); cognitive cost of "two sources of truth" (001 schema + later ALTERs).
**Evidence**: `src/db/database.ts:15-46`.

### ADR-004: Age gate for the AI chat

**Status**: Adopted.
**Date**: 2026-05-10 (commit `2262cd4` "Tighten DB migrations, refine UI, add AI age gate").
**Context**: legal and reputational liability when a minor receives erroneous nutritional advice is high. Robust parental verification is complex in a mobile app.
**Decision**: the AI chat is accessible only to profiles with `age ≥ 18`. Defense in depth: gate at the FAB, at the chat host (auto-close on profile switch), and in `sendMessage`.
**Positive consequences**: reduced liability for minors; meets COPPA-equivalent best practice.
**Negative consequences**: minors cannot interact with the AI directly in the app (must do so via the adult super-user).
**Evidence**: `src/modules/ai-engine/aiAccess.ts:13-22`, `src/components/layout/AIAssistantHost.tsx:43-44`, `src/modules/ai-engine/AIContext.tsx:131-132`.

### ADR-005: Pre-LLM topic gate via keyword stems

**Status**: Adopted.
**Date**: 2026-04-20 (commit `1ac2423` "Implemented profile selection").
**Context**: the local 1.7B LLM takes 2-5 s per turn. A question about football should not cost 2 s to return a canned refusal.
**Decision**: EN+ES keyword classifier with three verdicts (`in`/`out`/`ambiguous`). If `out`, return a canned refusal without calling the LLM.
**Positive consequences**: <1 ms latency for refusals; battery savings; reinforced scope control.
**Negative consequences**: stems may mark trivial in-scope queries as ambiguous; manual list maintenance.
**Evidence**: `src/services/topicGate.ts:14-156`.

### ADR-006: Pending facts require human confirmation before persisting

**Status**: Adopted.
**Date**: 2026-05-10 (memory-layer migration 011).
**Context**: the LLM fact extractor may hallucinate false memories. Auto-persisting would mean the AI "makes up things" about the user.
**Decision**: the `factExtractor` returns `CandidateFact[]`; the UI shows a banner "Want to remember this?"; only on acceptance is `addMemberMemory` called (encrypted + persisted).
**Positive consequences**: human in the loop (favorable under GDPR Art. 22); a false memory never persists without OK; more trustworthy UX.
**Negative consequences**: the user must interact to benefit from personalization; potentially lower feature adoption.
**Evidence**: `src/services/factExtractor.ts`, `src/modules/ai-engine/AIContext.tsx:99-123,346-353`.

### ADR-007: External-provider API secrets in the bundle via `EXPO_PUBLIC_`

**Status**: **Temporarily adopted — must be revisited before launch**.
**Date**: 2026-04-15 (initial commit).
**Context**: during prototype development, moving credentials behind a BFF added unnecessary complexity to validate the product.
**Decision**: use `EXPO_PUBLIC_FATSECRET_CLIENT_SECRET` and `EXPO_PUBLIC_SPOONACULAR_API_KEY` in `.env` and `process.env.*` in code.
**Positive consequences**: development speed, zero infra.
**Negative consequences**: **secrets exposed in the binary**. Any attacker can extract them and exhaust quotas or commit billing fraud.
**Retirement plan**: implement a BFF on Cloudflare Workers before the open beta. This ADR will be replaced by ADR-009 (BFF) when closed.
**Evidence (historical)**: `.env:5-7`, `src/services/fatsecret.ts:7-8`, `src/services/spoonacular.ts:7`. **Status (current)**: ADR-007 is **retired**. As of commit `1647aac`, no `EXPO_PUBLIC_*` API secrets ship in the bundle — every upstream is reached only through the BFF at `api.nutriassistant.org`. See ADR-009 (BFF) — to be authored — for the replacement architecture.

### ADR-008: Hard cap of 4,500 characters on the prompt

**Status**: Adopted.
**Date**: 2026-05-08 (post-Qwen migration).
**Context**: although Qwen 3 1.7B has a ~32k-token native context, mobile hardware has limited KV cache. With Llama 3.2 1B the effective limit was ~2k tokens; with Qwen 3 it rises but is not unlimited.
**Decision**: cap the system prompt at 4,500 chars (~1,100 tokens), truncating from the tail to preserve the topic guardrail and active-member info.
**Positive consequences**: consistent latency; no opaque "rendered chat too long" failures.
**Negative consequences**: in large families with many memories and PDFs, part of the context is silently truncated.
**Evidence**: `src/services/prompts/system.ts:52,259-263`.
