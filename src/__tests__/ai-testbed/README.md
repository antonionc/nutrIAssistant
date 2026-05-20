# AI Assistant Testbed

Automated behavioural test suite for **NutriBot**, the on-device AI assistant.
Where the rest of `src/__tests__/` checks individual units, this testbed
verifies the *assistant as a system*: that its security guardrails hold, that
memory and RAG retrieval surface the right context, that recipe/plan answers
are well-steered, and that every personalization signal reaches the model.

## Run it

```bash
npm run testbed     # capability-grouped report (recommended)
npm test            # the testbed also runs inside the normal Jest suite
```

`npm run testbed` runs only these suites and prints a report grouped by
capability, with an explicit PASS/FAIL per capability and a total. Exit code
is `0` only when every capability is green.

## What it covers

| Suite | Capability | Verifies |
|---|---|---|
| `security-harness.testbed.test.ts` | 🛡 Security harness | Topic gate hard-refuses off-topic queries (ES+EN corpus), in-scope queries pass, the under-18 age gate blocks minors, refusal copy is localized |
| `memory-rag.testbed.test.ts` | 🧠 Memory & RAG | Cosine math, PDF chunk top-k + threshold selection, durable-fact ranking (semantic + keyword fallback + recency floor) |
| `recipe-specialization.testbed.test.ts` | 🍲 Recipe specialization | System prompt steers recipe/plan format (ingredients, steps, macros) + allergen check, meal-plan prompt encodes the JSON contract, `<actions>` favorite protocol is crash-proof |
| `prompt-assembly.testbed.test.ts` | 🧩 Prompt assembly | About-me notes, ranked memories and retrieved PDF chunks all reach the prompt; conditions become directives; prompt is active-member-scoped, single-language and within the char budget |

The suites exercise **pure / deterministic** code only — no device, no model,
no network — so they run in well under a second and are safe in CI.

## Layer 2 — on-device behavioural eval

The model itself can't run inside Jest (it needs the native runtime + ~1 GB
of weights). For real-model behaviour — context retention, answer quality,
language coherence, end-to-end latency — use the **on-device eval**:

- **Code:** `src/services/aiEval/` (golden set + pure scorer; the scorer is
  covered by `eval-scorer.testbed.test.ts` in this folder).
- **Screen:** `app/dev/ai-eval.tsx` — dev-only, reachable from
  *Settings → "AI behavioural eval (dev)"* in a `__DEV__` build.

It runs ~18 scripted prompts through the **real** `AIContext.sendMessage`
pipeline, scores each reply (topic verdict, refusal vs. answer, no CoT leak,
content assertions, latency) and shows the full reply for human review.

Run this on a device or simulator **before shipping** any change that affects
generated text — prompt edits, model/embeddings swap, fact extractor changes.

## When to re-run it

Run the testbed (and add coverage to it) whenever you make a **deep change to
the AI assistant architecture**. Concretely, after editing any of:

- `src/services/onDeviceLlm.ts`, `src/services/embeddings.ts` — model or
  inference path (e.g. swapping the LLM or the embeddings model).
- `src/services/retrieval.ts`, `src/services/memoryStore.ts` — memory / RAG
  ranking or storage.
- `src/services/topicGate.ts` — the security harness keyword sets.
- `src/services/prompts/system.ts`, `src/services/aiActions.ts` — prompt
  assembly or the action protocol.
- `src/services/factExtractor.ts`, `src/modules/ai-engine/*` — the chat
  pipeline.
- `src/db/migrations/*` that touch `member_memories` or `doc_chunks`.

Claude Code is instructed (see the root `CLAUDE.md` → *AI testbed*) to suggest
running it after any such change.

## Extending it

Each suite is a curated corpus. When a real query reaches the wrong verdict,
or a regression slips through, **add the case to the relevant corpus** rather
than only fixing the code — the corpus is the regression net. Keep every new
test pure (no DB, no model); if you need a model output, assert on the
deterministic harness around it, not on the generated text.
