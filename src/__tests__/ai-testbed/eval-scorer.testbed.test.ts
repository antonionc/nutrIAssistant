/**
 * AI TESTBED — Behavioral eval scorer
 * ─────────────────────────────────────────────────────────────────────────────
 * The on-device eval harness (`app/dev/ai-eval.tsx`) runs the real model; its
 * verdict, however, comes from the PURE `scoreCase` / `summarize` functions.
 * If the scorer is wrong, every on-device run is wrong — so it is tested here.
 *
 * Run via `npm run testbed`. See ./README.md for when to re-run.
 */
import { scoreCase, summarize } from '../../services/aiEval/scorer'
import { GoldenCase, CaseObservation, CaseResult } from '../../services/aiEval/types'
import { t } from '../../i18n'

const baseCase = (expect: GoldenCase['expect']): GoldenCase => ({
  id: 'c', category: 'scope', title: 'case', prompt: 'p', expect, reviewNote: 'n',
})

const obs = (o: Partial<CaseObservation> = {}): CaseObservation => ({
  reply: 'A balanced answer about nutrition.', verdict: 'in', latencyMs: 1000, ...o,
})

const checkFor = (r: CaseResult, fragment: string) =>
  r.checks.find((c) => c.label.includes(fragment))

// ─── Always-on checks ────────────────────────────────────────────────────────

describe('Eval scorer · baseline checks', () => {
  it('passes a clean, in-budget reply', () => {
    const r = scoreCase(baseCase({ verdict: 'in', isRefusal: false }), obs())
    expect(r.passed).toBe(true)
  })

  it('fails an empty reply', () => {
    const r = scoreCase(baseCase({}), obs({ reply: '   ' }))
    expect(checkFor(r, 'non-empty')?.passed).toBe(false)
    expect(r.passed).toBe(false)
  })

  it('fails when the reply leaks a <think> chain-of-thought block', () => {
    const r = scoreCase(baseCase({}), obs({ reply: '<think>hmm</think> here you go' }))
    expect(checkFor(r, 'chain-of-thought')?.passed).toBe(false)
    expect(r.passed).toBe(false)
  })
})

// ─── Engine-error envelope ───────────────────────────────────────────────────
// When the in-flight LLM lock or a native runner failure produces a wrapped
// error string, the scorer must fail the case instead of scoring the envelope
// as a real answer.

describe('Eval scorer · engine-error envelope', () => {
  it('fails when the reply is the localized error prefix (model-busy wrap)', () => {
    const busy = `${t.ai.errorPrefix}: The model is currently generating. Please wait until previous model run is complete.`
    const r = scoreCase(baseCase({ verdict: 'in', isRefusal: false }), obs({ reply: busy }))
    expect(checkFor(r, 'engine error')?.passed).toBe(false)
    expect(r.passed).toBe(false)
  })

  it('fails when the reply is the modelPreparingMessage', () => {
    const r = scoreCase(baseCase({ verdict: 'in', isRefusal: false }), obs({ reply: t.ai.modelPreparingMessage }))
    expect(checkFor(r, 'engine error')?.passed).toBe(false)
    expect(r.passed).toBe(false)
  })

  it('passes the envelope check for a normal reply', () => {
    const r = scoreCase(baseCase({ verdict: 'in', isRefusal: false }), obs())
    expect(checkFor(r, 'engine error')?.passed).toBe(true)
  })
})

// ─── Topic verdict ───────────────────────────────────────────────────────────

describe('Eval scorer · topic verdict', () => {
  it('passes when the observed verdict matches', () => {
    const r = scoreCase(baseCase({ verdict: 'out' }), obs({ verdict: 'out' }))
    expect(checkFor(r, 'verdict')?.passed).toBe(true)
  })
  it('fails when the observed verdict differs', () => {
    const r = scoreCase(baseCase({ verdict: 'out' }), obs({ verdict: 'in' }))
    expect(checkFor(r, 'verdict')?.passed).toBe(false)
    expect(checkFor(r, 'verdict')?.detail).toContain('in')
  })
})

// ─── Refusal vs. real answer ─────────────────────────────────────────────────

describe('Eval scorer · refusal detection', () => {
  it('passes when a refusal was expected and received', () => {
    const r = scoreCase(baseCase({ isRefusal: true }), obs({ reply: "I'm NutriBot, so I can only help with nutrition." }))
    expect(checkFor(r, 'canned refusal')?.passed).toBe(true)
  })
  it('fails when a refusal was expected but a real answer came back', () => {
    const r = scoreCase(baseCase({ isRefusal: true }), obs({ reply: 'Here is a recipe.' }))
    expect(checkFor(r, 'canned refusal')?.passed).toBe(false)
  })
  it('fails when a real answer was expected but the model refused', () => {
    const r = scoreCase(baseCase({ isRefusal: false }), obs({ reply: 'Soy NutriBot, solo ayudo con nutrición.' }))
    expect(checkFor(r, 'not a refusal')?.passed).toBe(false)
  })
})

// ─── Content assertions ──────────────────────────────────────────────────────

describe('Eval scorer · content assertions', () => {
  it('passes mustInclude when every needle is present (case-insensitive)', () => {
    const r = scoreCase(baseCase({ mustInclude: ['NUTRITION'] }), obs({ reply: 'About nutrition.' }))
    expect(checkFor(r, 'Mentions')?.passed).toBe(true)
  })
  it('fails mustInclude when a needle is missing', () => {
    const r = scoreCase(baseCase({ mustInclude: ['quinoa'] }), obs({ reply: 'About rice.' }))
    expect(checkFor(r, 'Mentions')?.passed).toBe(false)
  })
  it('fails mustExclude when a forbidden needle appears', () => {
    const r = scoreCase(baseCase({ mustExclude: ['peanut'] }), obs({ reply: 'Try peanut butter.' }))
    expect(checkFor(r, 'Avoids')?.passed).toBe(false)
  })
})

// ─── Latency ─────────────────────────────────────────────────────────────────

describe('Eval scorer · latency hang-guard', () => {
  it('passes within budget', () => {
    const r = scoreCase(baseCase({ maxLatencyMs: 5000 }), obs({ latencyMs: 1200 }))
    expect(checkFor(r, 'within')?.passed).toBe(true)
  })
  it('fails over budget and reports the actual time', () => {
    const r = scoreCase(baseCase({ maxLatencyMs: 5000 }), obs({ latencyMs: 9000 }))
    expect(checkFor(r, 'within')?.passed).toBe(false)
    expect(checkFor(r, 'within')?.detail).toContain('9000')
  })
})

// ─── Summary aggregation ─────────────────────────────────────────────────────

describe('Eval scorer · summarize', () => {
  it('aggregates pass/fail counts and latency stats', () => {
    const results: CaseResult[] = [
      scoreCase(baseCase({ verdict: 'in' }), obs({ verdict: 'in', latencyMs: 1000 })),
      scoreCase(baseCase({ verdict: 'in' }), obs({ verdict: 'out', latencyMs: 3000 })),
    ]
    const s = summarize(results)
    expect(s.total).toBe(2)
    expect(s.passed).toBe(1)
    expect(s.failed).toBe(1)
    expect(s.avgLatencyMs).toBe(2000)
    expect(s.maxLatencyMs).toBe(3000)
  })
  it('handles an empty result set without dividing by zero', () => {
    expect(summarize([])).toEqual({ total: 0, passed: 0, failed: 0, avgLatencyMs: 0, maxLatencyMs: 0 })
  })
})
