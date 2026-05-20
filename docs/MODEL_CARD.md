# Model Card — Qwen 3 1.7B Quantized as deployed in NutrIAssistant

**Card version:** 1.0
**Card date:** 2026-05-13
**Model owner:** NutrIAssistant (hola@nutriassistant.org)

This card follows the Google Model Card template. It documents how Qwen 3
1.7B Quantized is *configured and used inside NutrIAssistant*, not the
upstream model in isolation. For the upstream model's training details
refer to the HuggingFace repository linked under "Training data".

## Model details

| | |
|---|---|
| Upstream model | Qwen3-1.7B Quantized (8-bit) |
| Format | `.pte` (PyTorch ExecuTorch) |
| Approx. size | ~1.2 GB (.pte) + ~5 MB (tokenizers) |
| Native context | ~32k tokens (capped to 4,500 chars by the app's system-prompt builder) |
| Inference runtime | `react-native-executorch` v0.8.3 on iOS 18.1+ and Android 8+ |
| Distribution | Cloudflare R2 mirror via NutrIAssistant BFF (`api.nutriassistant.org/v1/llm/qwen3-1.7b/*`) — see `infra/bff/README.md` |
| Upstream source | https://huggingface.co/software-mansion/react-native-executorch-qwen-3 @ `v0.8.0` |
| First shipped in | NutrIAssistant commit `975baad` (May 2026), replacing Llama 3.2 1B Q (commit `125606c`) |

## Intended use

- Family-nutrition conversational assistant: recipe suggestions, ingredient
  substitutions, meal-plan curation, school-menu parsing, durable-fact
  extraction from the user's own chat turns.
- Operates on data the user has explicitly provided (profile, pantry,
  uploaded medical PDFs) and never on data outside the device.
- Output is rendered as Markdown chat bubbles in `src/components/layout/MarkdownText.tsx`
  with a persistent "not medical advice" disclaimer.

## Out-of-scope

- **Medical diagnosis or treatment recommendations.** The disclaimer in the
  chat UI is non-dismissible for this reason.
- **Drug-interaction analysis, dosage calculations, emergency triage.**
- **Identification of individuals from images.** No vision model is shipped.
- **Use in jurisdictions where the privacy policy has not been adapted.**
  The app targets Spain at launch.

## Training data

NutrIAssistant does NOT retrain or fine-tune the model. We ship the
upstream Qwen3-1.7B-Quantized weights unchanged. See the upstream HF
repository for training-data provenance and licensing.

## Evaluation

- We have NOT performed formal RAGAS / golden-set evaluation of the
  composed system (prompt + retrieval + model).
- Anecdotal evaluation during development:
  - Spanish and English instruction-following is acceptable for the
    target tasks at the 4,500-char prompt budget.
  - JSON-schema responses (for `<actions>` blocks and school-menu
    extraction) require permissive parsers — see `parseSchoolMenuResponse`
    in `src/modules/planner/PlannerContext.tsx` for the recovery layers.
  - On devices with <6 GB RAM the model OOMs during executorch load;
    the app detects this and disables the AI feature gracefully (see
    `src/services/deviceCapabilities.ts`).

## Ethical considerations & known biases

- **Cuisine bias.** The recipe catalog is sourced from Edamam (Mediterranean
  preset) and Spoonacular (20 predefined cuisines, Western-heavy). The
  model itself does not introduce this bias, but the catalog it summarises
  does. A user querying "Halal-friendly weekly plan" may receive
  suggestions skewed toward the catalog's Mediterranean baseline.
- **Health-condition heuristics.** The system prompt offers nutritional
  guidance for hypertension, celiac disease, type 1/2 diabetes, and
  similar conditions (`src/services/prompts/system.ts`). The model is NOT
  a clinical decision-support system; suggestions are food-substitution
  hints, not medical advice. The UI disclaimer reinforces this.
- **Locale coverage.** The chat is fluent in ES/EN; other languages are
  not officially supported.

## Caveats and limitations

- Capped at ~1.7B parameters: responses are noticeably less nuanced than
  state-of-the-art frontier models.
- The ~1.2 GB initial download is a usability cost on metered networks;
  the boot flow notifies the user before kicking it off.
- Hash verification of the `.pte` is currently pinned to empty (see
  `src/services/onDeviceLlm.ts#EXPECTED_MODEL_PTE_SHA256`). The tokenizer
  JSONs gain real pins as soon as upload runbook produces them.

## Reporting issues

Open an issue at https://github.com/cspitzer/nutriassistant/issues or
email hola@nutriassistant.org.
