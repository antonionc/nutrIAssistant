# 05 — Privacy Model

**Current state:** the local-first architecture provides an extraordinarily solid base for privacy (data never leaves the device), but formal GDPR elements are missing: published privacy policy, Records of Processing Activities (ROPA), DPIA, designated DPO, granular consent, and effective erasure. This section breaks down what is in place and what is missing, with evidence.

## 5.1. Personal-data inventory

| Data | Category | GDPR legal basis | Purpose | Retention | Recipients | International transfer | Minimization |
|---|---|---|---|---|---|---|---|
| `name`, `role` | Basic PII | Art. 6.1.b (contract performance) | Member identification | Until deleted | None (local) | No | No surnames required |
| `dateOfBirth` | PII | 6.1.b | Age computation for personalization + AI gate | Same | Local | No | — |
| `weight`, `height` | **Health — Art. 9** | **9.2.a** (explicit consent) ⚠️ no evidence of capture | Caloric calculation, recommendations | Same | Local | No | Single measurement (no history) |
| `bloodPressure`, `hrv`, `spO2`, `restingHeartRate` | **Health — Art. 9** | 9.2.a ⚠️ | Complementary profile info | Same | Local | No | Optional (not required) |
| `allergies` | **Health — Art. 9** | 9.2.a ⚠️ | Meal compatibility, food safety | Same | Local | No | EU-14 closed catalog |
| `conditions` | **Health — Art. 9** | 9.2.a ⚠️ | Personalized AI directives | Same | Local | No | Closed catalog of 8 conditions |
| `dietPreference` | PII (potentially Art. 9 if it reflects religious belief — *vegan, kosher*) | 9.2.a ⚠️ | Personalization | Same | Local | No | Single option |
| `aboutMeNotes` | PII / possibly Art. 9 | 9.2.a ⚠️ | AI personalization | Same (encrypted) | Local | No | Free text — overshare risk |
| `avatarUrl` (image) | PII (potentially biometric if a photo) | 6.1.b | UX | Same | Local | No | Optional; defaults to an illustration |
| `documents[]` + PDFs | **Health — Art. 9** | 9.2.a ⚠️ + 9.2.h (healthcare assistance) where applicable | Medical RAG | Same | Local | **No** (on-device processing) | 8,000-char cap when summarizing |
| `aiSummary` | Derived Art. 9 | Same | Prompt injection | Same (partial encryption) | Local | No | 500-char cap |
| `member_memories` | **Art. 9** (health and routine memories) | 9.2.a ⚠️ | Personalization | Same (encrypted) | Local | No | 120-char cap, ≤3 facts per turn |
| `doc_chunks.embedding` | Derived Art. 9 (invertible) | 9.2.a ⚠️ | RAG | Same (encrypted) | Local | No | — |
| `inventory_items.*` | Non-PII (pantry) | 6.1.b | Pantry management | Configurable | Local | No | — |
| Health data (steps, kcal) | **Health — Art. 9** | 9.2.a + 9.2.h | Daily-energy estimation | Refreshes on request | Local | Apple/Google (OS-bounded) | Today only (`startOfTodayIso`, `appleHealth.ts:38-42`) |
| `meal_plans` with `school_menu_context` | Child PII | 9.2.a + parental consent | Family personalization | 90 d proposed | Local | No | Description + ingredients only |
| `scan_history` | Non-PII (scanned products) | 6.1.b | Traceability | 180 d proposed | Local | No | — |
| FatSecret tokens | Technical credential | 6.1.f (legitimate interest) | Third-party auth | OAuth expiration | **Ship in client bundle to provider** | **FatSecret (US)** | Token-based, no PII |
| Spoonacular API key | Technical credential | 6.1.f | API access | Persistent | **Ships in client bundle** | **Spoonacular (US)** | — |
| HuggingFace CDN | Public models | 6.1.f | Initial download | Permanent cache | **HuggingFace (US)** | **Yes** ⚠️ | — |

## 5.2. Legal basis and consent

**Current state:** the only implicit "consent" is the onboarding moment. There is no dedicated UI to capture granular consents or to record proof of consent (Art. 7.1 GDPR: *"the controller shall be able to demonstrate that the data subject has consented"*).

**Health data → Art. 9.2.a**: explicit consent must be:

- Freely given (no detriment if refused)
- Specific (per purpose)
- Informed (the user must know what happens to their data)
- Unambiguous (clear affirmative action — not opt-out)

**Minimum viable consent (recommendation)**:

- Toggle 1: *Process my health data (weight, height, allergies, conditions) to personalize nutrition recommendations*. **Blocking**: if refused, the app does not work or degrades to a basic mode (no profile).
- Toggle 2: *Enable the conversational AI assistant (on-device processing)*. **Granular**: independent opt-in.
- Toggle 3: *Allow the assistant to automatically extract facts from our conversations to personalize itself (always with prior confirmation)*. **Granular**.
- Toggle 4: *Process my medical PDF documents through on-device AI to enrich responses*. **Granular**.
- Toggle 5: *Share anonymous, aggregated metrics to improve the product*. **Granular**, **off by default**. ⚠️ The switch exists in UI (`app/settings.tsx:507-514`) but is `disabled` and `value={false}`.

**Just-in-time prompts**: the first time the user taps the "upload PDF" button, show a mini-modal "we'll process this document on-device so the AI can give you more accurate answers. Continue?".

## 5.3. GDPR principles applied to the design

| Principle | How it applies today | Evidence | Gap |
|---|---|---|---|
| **Privacy by design** | ✅ Excellent — on-device architecture | All of [§4](./04-ai-architecture.md) | — |
| **Privacy by default** | 🟡 — non-existent toggles cannot be "off by default"; granular consent is missing | `app/settings.tsx:509-514` (disabled switch) | Implement onboarding with toggles off by default |
| **Minimization** | 🟡 Partial — `bloodPressure`, `hrv`, `spO2` are requested but unused (no engine consumes them) | `src/types/profiles.ts:57-60` | Remove unused fields or mark them optional and justify them |
| **Purpose limitation** | 🟡 Implicit — the app uses data only for nutrition. No written policy | — | Document purposes in the privacy policy and enforce in code |
| **Storage limitation** | 🔴 GAP — no retention job | `src/db/migrations/` (no scheduled DELETE) | Implement a retention sweeper |
| **Accuracy** | 🟡 — UX allows editing everything (`app/settings.tsx:738-848`) | — | Range validation on weight/height/age |
| **Integrity and confidentiality** | 🟡 — critical fields encrypted, not all | [§3.1](./03-security-encryption.md#31-data-encryption-policy) | Encrypt all PII |
| **Proactive responsibility (accountability)** | 🔴 GAP — no ROPA, no logs, no DPIA | — | [§5.5](#55-gdpr-roadmap-8-steps--current-status) 8-step roadmap |

## 5.4. Data-subject rights implemented in the app

| GDPR right | State | Where it is exercised in UI | Endpoint / handler | Proposed SLA |
|---|---|---|---|---|
| Access (data download) | ✅ "Export family" produces Markdown + JSON | `app/settings.tsx:473-482` | `exportFamilyToMarkdown` `src/services/familyExport.ts:36-69` | <1 min (local) |
| Rectification | ✅ Full profile editor | `app/settings.tsx:738-848` | `updateProfile` `src/modules/profiles/ProfilesContext.tsx:147-159` | Immediate |
| Erasure (right to be forgotten) | 🔴 **Stub**: the button exists but the handler is `onPress: () => {}` (TODO commented) | `app/settings.tsx:517-524` | `// TODO: implement full data deletion` `app/settings.tsx:516` | n/a |
| Restriction | 🟡 Partial — health provider can be deactivated, recipe sources can be disconnected; no "global pause" | `app/settings.tsx:73-77, 622-630` | `deactivateProvider`, `setSourceEnabled` | Immediate |
| Portability | ✅ JSON inside the Markdown export is machine-readable | `src/services/familyExport.ts:43,60-62` | Same | <1 min |
| Objection | 🔴 GAP — no dedicated UI | — | — | — |
| **Right not to be subject to automated decisions (Art. 22)** | 🟡 The AI makes suggestions, not legal/significant decisions; explicit disclaimer and easy chat opt-out missing | [§4.6](./04-ai-architecture.md#46-ai-governance) | — | — |

**Critical action**: implement full erasure as follows:

```ts
// pseudo-code proposal — DOES NOT exist in the repo
async function fullWipe() {
  await deactivateProvider()                        // health off
  await closeDatabase()                              // close sqlite
  await SQLite.deleteDatabaseAsync('nutriassistant.db')
  await AsyncStorage.clear()                         // profiles, flags, tokens
  await SecureStore.deleteItemAsync(KEY_NAME)        // master key
  await FileSystem.deleteAsync(`${docDir}profile-documents/`, {idempotent:true})
  await FileSystem.deleteAsync(`${docDir}avatars/`,           {idempotent:true})
  await FileSystem.deleteAsync(`${docDir}react-native-executorch/`, {idempotent:true})
  // then: relaunch app to onboarding
}
```

## 5.5. GDPR roadmap (8 steps) — current status

| # | Step | State | Required actions |
|---|---|---|---|
| 1 | DPO appointment | 🔴 No | Designate an internal or external DPO (mandatory for Art. 9 data at scale). Publish contact: `dpo@nutriassistant.ai` |
| 2 | User notification systems (Art. 33-34: breaches, policy changes) | 🔴 No | `expo-notifications` already integrated (`src/services/aiNotifications.ts:48-54`); a "policy changes" channel is missing. Implement an "Announcements" screen + optional email |
| 3 | Published, accessible privacy policy | 🔴 No (Settings → Contact links to the web but not to a specific policy, `app/settings.tsx:530-534`) | Draft and publish at `nutriassistant.ai/privacy` and link from Settings + onboarding |
| 4 | ROPA (Records of Processing Activities) | 🔴 No | Generate ROPA v1 documenting the 18 activities in [§5.1](#51-personal-data-inventory) |
| 5 | Risk analysis | 🔴 No (preliminary STRIDE in [§3.5](./03-security-encryption.md#35-threat-model-simplified-stride)) | Formalize and sign off |
| 6 | Security-measures review | 🟡 Partial (this document) | Annual external audit |
| 7 | Contingency mechanisms (IR plan, breach notification) | 🔴 No | Define a runbook: detection → containment → AEPD notification (<72h) → user communication |
| 8 | DPIA (Data Protection Impact Assessment) | 🔴 No — **mandatory** because health data is processed systematically | Perform a DPIA before public launch (Art. 35) |

## 5.6. International transfers (Schrems II)

| Provider | Country | Data transferred | Required safeguards | Status |
|---|---|---|---|---|
| OpenFoodFacts | France (EU) | Barcode (no PII) | None special (intra-EU) | ✅ |
| FatSecret | United States | OAuth token + search queries (no user PII) | SCC + TIA | 🔴 Not signed |
| Spoonacular | United States | API key + search queries (no user PII) | SCC + TIA | 🔴 Not signed |
| HuggingFace CDN | United States | `.pte` model download (no PII) | n/a (public-asset download) | ✅ (public asset) |
| Apple Health | iCloud (EU if EU user) | Health metrics | Apple DPA | ✅ (Apple's responsibility) |
| Google Health Connect | On-device | n/a | n/a | ✅ |

**Main risk**: although the FatSecret and Spoonacular queries do not carry user PII, they do carry search context. A query like *"gluten-free, low-sodium recipes for diabetics"* infers aggregate health conditions. **Recommendation**: an EU BFF that strips context before relaying.

**EU-only alternatives for cloud AI** (once opt-in is introduced):

- Mistral AI (France) — Mistral Large / Small
- Aleph Alpha (Germany) — Luminous
- Hosted Qwen 3 on RunPod EU or vLLM on Hetzner

## 5.7. Data of minors

| Aspect | State | Evidence |
|---|---|---|
| Existence of minor profiles | ✅ The `isSchoolAge` field distinguishes them. Automatic backfill: `getAge(dateOfBirth) < 18 ⇒ isSchoolAge=true` | `src/modules/profiles/ProfilesContext.tsx:84-86` |
| AI gate by age | ✅ AI chat only accessible if `age ≥ 18` | `src/modules/ai-engine/aiAccess.ts:13-22` |
| Verifiable parental consent | 🔴 GAP — minimum consent age in Spain is 14; in the US (COPPA) it is 13. The app does not verify that the adult filling in the child's profile is the parent | — |
| "Child mode" tab | 🔴 GAP | — |
| Processing only under parental consent | 🟡 Implicit (only super-user can add profiles, `app/settings.tsx:318-326`); explicit declaration missing | — |

**Recommendation**: add a parental-declaration checkbox: *"I confirm that I am the parent or legal guardian of the minors included in this family profile, and I consent to the processing of their data for the stated purposes"*. Persist timestamp + member_id_added as proof.

## 5.8. Special-category data processing (Art. 9)

As [§5.1](#51-personal-data-inventory) shows, NutrIAssistant is **fundamentally an Art. 9 app**: weight, height, allergies, conditions, clinical PDFs, religious diet (vegan/halal/etc. potentially), and derived biometric information (HR from wearables).

**Mandatory technical reinforcements**:

- Encrypt EVERY Art. 9 field, not only `conditions` and `aboutMeNotes` ([§3.1](./03-security-encryption.md#31-data-encryption-policy) recommendation 1).
- Encrypt PDFs at rest ([§3.5](./03-security-encryption.md#35-threat-model-simplified-stride) STRIDE).
- Optional biometric app lock (FaceID/TouchID) for super-user — only then is the (wrapped) key decryptable.
- PDF isolation under `documentDirectory/profile-documents/<member_id>/` (✅ already implemented: `src/services/profileDocuments.ts:15-26`).

**Mandatory organizational reinforcements**:

- Designated DPO ([§5.5](#55-gdpr-roadmap-8-steps--current-status) step 1).
- Documented DPIA ([§5.5](#55-gdpr-roadmap-8-steps--current-status) step 8).
- Clear communication to the user about why these data are requested and what happens to them.

## 5.9. Anonymization vs Pseudonymization

| Concept | Recommended application in NutrIAssistant |
|---|---|
| **Anonymization** | Applies when publishing aggregate datasets (B2B, [§8.8](./08-production-readiness.md#88-business-model-and-data-monetization)). Example: "allergen distribution by postal code in Spain". k-anonymity with k≥50 + differential privacy for numeric queries |
| **Pseudonymization** | Applies once a BFF exists: client sends `device_id_hashed` (HMAC-SHA256 with salt in KMS), not `member_id` or `email`. The BFF cannot reverse it |
| **Differential privacy** | Recommended for aggregate telemetry (Apple-style noise) |
| **Current state** | 🔴 GAP — none of this is applied yet. The app is 100% identifiable to anyone with access to the device, but the device is the data subject's property → it is "first party" and risk is concentrated |

**Prioritized recommendations (section 5):**

1. **Publish a privacy policy** on the web + link from the app (Settings + onboarding).
2. **Implement full erasure** (empty handler at `app/settings.tsx:520`).
3. **Implement a granular consent screen** with the 5 toggles proposed in [§5.2](#52-legal-basis-and-consent).
4. **Commission an external DPIA** (Art. 35) before launch.
5. **Document the ROPA** (Records of Processing Activities).
6. **Encrypt all PII fields** (not only the current critical ones).
7. **Designate a DPO** (internal or external) and publish their email.
