#!/usr/bin/env node
/**
 * NutrIAssistant — AI Assistant Testbed runner
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs the behavioural test suite for the AI assistant (`src/__tests__/
 * ai-testbed/`) and prints a capability-grouped report instead of raw Jest
 * output. Each suite maps to one AI capability; the report makes it obvious
 * at a glance whether the security harness, memory/RAG, recipe specialization
 * and prompt assembly all still hold.
 *
 * Usage:  npm run testbed
 *
 * Exit code mirrors Jest: 0 = every capability green, 1 = a regression.
 * See src/__tests__/ai-testbed/README.md for WHEN to run this.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
}

// Suite file fragment → capability metadata. Ordered as the report renders.
const CAPABILITIES = [
  { match: 'security-harness', icon: '🛡', label: 'Security harness — topic & age gating' },
  { match: 'memory-rag', icon: '🧠', label: 'Memory & RAG retrieval' },
  { match: 'recipe-specialization', icon: '🍲', label: 'Recipe & nutrition-plan specialization' },
  { match: 'prompt-assembly', icon: '🧩', label: 'Prompt assembly & preference adherence' },
  { match: 'eval-scorer', icon: '🧪', label: 'On-device eval scorer' },
]

const LINE_WIDTH = 66

function rule(ch = '─') {
  return C.dim + ch.repeat(LINE_WIDTH) + C.reset
}

function header() {
  console.log('')
  console.log('  ' + C.bold + C.cyan + 'NutrIAssistant · AI Assistant Testbed' + C.reset)
  console.log('  ' + rule('═'))
}

function padded(left, right) {
  const visibleLeft = left.replace(/\x1b\[[0-9;]*m/g, '')
  const visibleRight = right.replace(/\x1b\[[0-9;]*m/g, '')
  const dots = Math.max(3, LINE_WIDTH - visibleLeft.length - visibleRight.length - 2)
  return '  ' + left + ' ' + C.dim + '.'.repeat(dots) + C.reset + ' ' + right
}

// ─── Run Jest ────────────────────────────────────────────────────────────────

const outFile = join(tmpdir(), `nutri-ai-testbed-${process.pid}-${Date.now()}.json`)

header()
console.log('  ' + C.dim + 'Running behavioural suites…' + C.reset + '\n')

const jest = spawnSync(
  'npx',
  ['jest', '--testPathPattern', 'ai-testbed', '--json', `--outputFile=${outFile}`, '--silent'],
  { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }
)

if (!existsSync(outFile)) {
  console.error('  ' + C.red + 'Testbed failed to run — no result file produced.' + C.reset)
  if (jest.stderr) console.error(C.dim + jest.stderr.slice(-2000) + C.reset)
  console.error('  Try `npm test` for the raw Jest output.')
  process.exit(1)
}

let report
try {
  report = JSON.parse(readFileSync(outFile, 'utf8'))
} finally {
  rmSync(outFile, { force: true })
}

// ─── Aggregate by capability ─────────────────────────────────────────────────

const buckets = CAPABILITIES.map((c) => ({ ...c, passed: 0, failed: 0, failures: [] }))
let unmatched = { passed: 0, failed: 0, failures: [] }

for (const suite of report.testResults ?? []) {
  const cap = buckets.find((b) => suite.name.includes(b.match)) ?? unmatched
  for (const a of suite.assertionResults ?? []) {
    if (a.status === 'passed') cap.passed++
    else if (a.status === 'failed') {
      cap.failed++
      cap.failures.push(a.fullName || a.title)
    }
  }
}

// ─── Render report ───────────────────────────────────────────────────────────

console.log('')
for (const cap of buckets) {
  const total = cap.passed + cap.failed
  const ok = cap.failed === 0 && total > 0
  const verdict = total === 0
    ? C.yellow + 'NO TESTS' + C.reset
    : ok
      ? C.green + C.bold + 'PASS' + C.reset
      : C.red + C.bold + 'FAIL' + C.reset
  const score = `${ok || total === 0 ? C.green : C.red}${cap.passed}/${total}${C.reset}`
  console.log(padded(`${cap.icon}  ${cap.label}`, `${score}  ${verdict}`))
  for (const f of cap.failures) {
    console.log('     ' + C.red + '✗ ' + C.reset + C.dim + f + C.reset)
  }
}

console.log('  ' + rule())

const totalPassed = report.numPassedTests ?? 0
const totalTests = report.numTotalTests ?? 0
const allGreen = report.success === true && totalTests > 0
const totalVerdict = allGreen
  ? C.green + C.bold + 'PASS' + C.reset
  : C.red + C.bold + 'FAIL' + C.reset
console.log(
  padded(
    C.bold + 'TOTAL' + C.reset,
    `${allGreen ? C.green : C.red}${totalPassed}/${totalTests}${C.reset}  ${totalVerdict}`
  )
)

const elapsed = report.startTime ? ((Date.now() - report.startTime) / 1000).toFixed(1) : '?'
console.log('  ' + C.dim + `${report.numTotalTestSuites ?? 0} suites · ${elapsed}s` + C.reset)

// ─── Deep-change advisory ────────────────────────────────────────────────────

console.log('')
console.log('  ' + C.bold + 'Re-run this testbed after touching the AI architecture:' + C.reset)
for (const f of [
  'services/onDeviceLlm.ts · embeddings.ts        (model / inference)',
  'services/retrieval.ts · memoryStore.ts         (memory & RAG)',
  'services/topicGate.ts                          (security harness)',
  'services/prompts/system.ts · aiActions.ts      (prompt / actions)',
  'services/factExtractor.ts · modules/ai-engine  (pipeline)',
  'db/migrations/* affecting member_memories / doc_chunks',
]) {
  console.log('   ' + C.dim + '· ' + C.reset + f)
}
console.log('')
console.log(
  '  ' + C.dim +
    'This suite tests the model-free harness. For real-model behaviour (context,' +
    C.reset
)
console.log(
  '  ' + C.dim +
    'answer quality, latency) run the on-device eval: a dev build → Settings →' +
    C.reset
)
console.log('  ' + C.dim + '"AI behavioural eval (dev)".' + C.reset)
console.log('')

process.exit(allGreen ? 0 : 1)
