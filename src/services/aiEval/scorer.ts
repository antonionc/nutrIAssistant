import { GoldenCase, CaseObservation, CaseResult, CheckResult, EvalSummary } from './types'
import { isCannedRefusal } from '../topicGate'

// Pure scorer for the on-device AI eval. Given a golden case and what the
// real pipeline produced, it derives the machine-checkable verdict. Pure and
// deterministic — covered by `src/__tests__/ai-testbed/eval-scorer.testbed.test.ts`.

function includesCI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

export function scoreCase(c: GoldenCase, obs: CaseObservation): CaseResult {
  const checks: CheckResult[] = []
  const reply = obs.reply ?? ''

  // Always: a usable, leak-free reply.
  checks.push({ label: 'Reply is non-empty', passed: reply.trim().length > 0 })
  const leaked = /<think>/i.test(reply)
  checks.push({
    label: 'No <think> chain-of-thought leakage',
    passed: !leaked,
    detail: leaked ? 'reply contains a <think> tag' : undefined,
  })

  // Topic-gate verdict.
  if (c.expect.verdict) {
    const ok = obs.verdict === c.expect.verdict
    checks.push({
      label: `Topic gate verdict is "${c.expect.verdict}"`,
      passed: ok,
      detail: ok ? undefined : `got "${obs.verdict}"`,
    })
  }

  // Refusal vs. real answer.
  if (c.expect.isRefusal !== undefined) {
    const wasRefusal = isCannedRefusal(reply)
    const ok = wasRefusal === c.expect.isRefusal
    checks.push({
      label: c.expect.isRefusal
        ? 'Reply is the canned refusal'
        : 'Reply is a real answer (not a refusal)',
      passed: ok,
      detail: ok ? undefined : wasRefusal ? 'got a refusal' : 'expected a refusal',
    })
  }

  // Conservative content assertions.
  for (const needle of c.expect.mustInclude ?? []) {
    checks.push({ label: `Mentions "${needle}"`, passed: includesCI(reply, needle) })
  }
  for (const needle of c.expect.mustExclude ?? []) {
    checks.push({ label: `Avoids "${needle}"`, passed: !includesCI(reply, needle) })
  }

  // Latency hang-guard.
  if (c.expect.maxLatencyMs !== undefined) {
    const ok = obs.latencyMs <= c.expect.maxLatencyMs
    checks.push({
      label: `Responded within ${c.expect.maxLatencyMs} ms`,
      passed: ok,
      detail: ok ? undefined : `took ${obs.latencyMs} ms`,
    })
  }

  return {
    caseId: c.id,
    category: c.category,
    title: c.title,
    passed: checks.every((ch) => ch.passed),
    checks,
    observation: obs,
    reviewNote: c.reviewNote,
  }
}

export function summarize(results: CaseResult[]): EvalSummary {
  const latencies = results.map((r) => r.observation.latencyMs)
  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    avgLatencyMs: latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0,
    maxLatencyMs: latencies.length ? Math.max(...latencies) : 0,
  }
}
