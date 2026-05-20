import { TopicVerdict } from '../topicGate'

// Data model for the on-device AI behavioural eval harness. Where the Jest
// AI testbed (`src/__tests__/ai-testbed/`) checks the deterministic harness
// without a model, this harness runs the **real** on-device pipeline
// (`AIContext.sendMessage` → Qwen 3) and scores the generated replies.
// It is driven from the dev-only screen `app/dev/ai-eval.tsx`.

export type EvalCategory =
  | 'scope' // security harness — off-topic must be refused
  | 'nutrition' // factual nutrition answers
  | 'format' // recipe / plan answer shape
  | 'safety' // allergen / condition awareness
  | 'context' // multi-turn memory within a chat
  | 'language' // single-language coherence

// One scripted prompt (optionally preceded by setup turns) plus the
// machine-checkable expectations and a human review note.
export interface GoldenCase {
  id: string
  category: EvalCategory
  title: string
  // Turns sent first, in the same chat, to establish context. Used by
  // `context` cases — the scored `prompt` is sent last.
  setupTurns?: string[]
  prompt: string
  expect: {
    // Expected topic-gate verdict (recomputed deterministically by the runner).
    verdict?: TopicVerdict
    // true → the reply must be the canned refusal; false → a real answer.
    isRefusal?: boolean
    // Case-insensitive substrings — ALL must appear / NONE may appear. Use
    // sparingly: free-form model text makes these flaky. High-confidence
    // only (e.g. a refusal must mention "NutriBot").
    mustInclude?: string[]
    mustExclude?: string[]
    // Upper bound on total response latency. A hang guard, not a perf SLA —
    // the screen also shows the raw number for human judgement.
    maxLatencyMs?: number
  }
  // What a human reviewer should eyeball in the displayed reply — the
  // qualitative half of the evaluation that no assertion can capture.
  reviewNote: string
}

// What the runner observed by driving the real pipeline.
export interface CaseObservation {
  reply: string
  verdict: TopicVerdict
  latencyMs: number
}

export interface CheckResult {
  label: string
  passed: boolean
  detail?: string
}

export interface CaseResult {
  caseId: string
  category: EvalCategory
  title: string
  passed: boolean
  checks: CheckResult[]
  observation: CaseObservation
  reviewNote: string
}

export interface EvalSummary {
  total: number
  passed: number
  failed: number
  avgLatencyMs: number
  maxLatencyMs: number
}
