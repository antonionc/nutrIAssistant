/**
 * AI behavioural eval — DEV-ONLY screen.
 * ─────────────────────────────────────────────────────────────────────────────
 * Drives the REAL on-device pipeline (`AIContext.sendMessage` → Qwen 3) over
 * the golden set in `src/services/aiEval/goldenSet.ts`, scores each reply, and
 * shows a pass/fail + latency report. This is the on-device counterpart to the
 * Jest AI testbed (`npm run testbed`), which can only test the model-free
 * harness. Run it on a device/simulator before shipping AI changes.
 *
 * Strings are intentionally inline (not i18n): the whole screen is gated to
 * `__DEV__` and never ships in a release build — it is developer-facing only.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAIEngine } from '../../src/modules/ai-engine/AIContext'
import { useSelectedProfile } from '../../src/modules/profiles/SelectedProfileContext'
import { useProfiles } from '../../src/modules/profiles/ProfilesContext'
import { isAIAccessibleForMember } from '../../src/modules/ai-engine/aiAccess'
import { classify } from '../../src/services/topicGate'
import { GOLDEN_SET } from '../../src/services/aiEval/goldenSet'
import { scoreCase, summarize } from '../../src/services/aiEval/scorer'
import { CaseResult, EvalCategory } from '../../src/services/aiEval/types'
import { Colors, Typography, Spacing, BorderRadius } from '../../src/theme'
import { useTheme, ThemeColors } from '../../src/theme/ThemeContext'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const CATEGORY_COLOR: Record<EvalCategory, string> = {
  scope: Colors.infoBlue,
  nutrition: Colors.healthGreen,
  format: Colors.forestGreen,
  safety: Colors.errorRed,
  context: '#8B5CF6',
  language: Colors.goldenAmber,
}

export default function AIEvalScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  if (!__DEV__) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.devOnly}>
            This diagnostics screen is available in development builds only.
          </Text>
        </View>
      </SafeAreaView>
    )
  }
  return <EvalRunner styles={styles} colors={colors} />
}

function EvalRunner({ styles, colors }: { styles: EvalStyles; colors: ThemeColors }) {
  const engine = useAIEngine()
  const { selectedId } = useSelectedProfile()
  const { profiles } = useProfiles()

  // Always call the latest engine functions/state — `runAll` is a long-lived
  // async loop and would otherwise close over a stale `sendMessage`/`messages`.
  const engineRef = useRef(engine)
  useEffect(() => {
    engineRef.current = engine
  }, [engine])

  const [results, setResults] = useState<CaseResult[]>([])
  const [running, setRunning] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const activeMember = profiles.find((p) => p.id === selectedId) ?? null
  const aiReachable = isAIAccessibleForMember(activeMember)
  const modelLoaded = engine.modelStatus.isLoaded
  const summary = summarize(results)

  // Sends one chat turn and resolves with the settled assistant reply.
  // `sendMessage` already awaits generation; the short poll only waits for
  // React to flush the final message into the context value.
  const runOneTurn = useCallback(
    async (prompt: string): Promise<{ reply: string; latencyMs: number }> => {
      const t0 = Date.now()
      await engineRef.current.sendMessage(prompt)
      let reply = ''
      for (let i = 0; i < 120; i++) {
        await sleep(50)
        const msgs = engineRef.current.messages
        const last = msgs[msgs.length - 1]
        if (last && last.role === 'assistant' && !last.isStreaming) {
          reply = last.content
          break
        }
      }
      return { reply, latencyMs: Date.now() - t0 }
    },
    []
  )

  const runAll = useCallback(async () => {
    setRunning(true)
    setResults([])
    setExpanded(new Set())
    try {
      for (const c of GOLDEN_SET) {
        setCurrentId(c.id)
        engineRef.current.clearHistory()
        await sleep(150) // let the cleared history propagate before sending
        if (c.setupTurns) {
          for (const turn of c.setupTurns) await runOneTurn(turn)
        }
        const { reply, latencyMs } = await runOneTurn(c.prompt)
        const result = scoreCase(c, { reply, verdict: classify(c.prompt), latencyMs })
        setResults((prev) => [...prev, result])
      }
    } finally {
      engineRef.current.clearHistory()
      setCurrentId(null)
      setRunning(false)
    }
  }, [runOneTurn])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Runs {GOLDEN_SET.length} scripted prompts through the real on-device pipeline and
          scores each reply. Auto-checks cover the harness (topic gate, refusal, no CoT leak,
          latency); answer quality is for you to review against each case&apos;s note.
        </Text>

        {!aiReachable && (
          <View style={[styles.banner, styles.bannerError]}>
            <Text style={styles.bannerText}>
              Select an adult (18+) profile — the AI age gate blocks the current profile, so
              `sendMessage` is a no-op.
            </Text>
          </View>
        )}
        {aiReachable && !modelLoaded && (
          <View style={[styles.banner, styles.bannerWarn]}>
            <Text style={styles.bannerText}>
              On-device model not loaded yet. The first case will trigger loading (and may be
              slow, or download ~1 GB on a fresh install).
            </Text>
          </View>
        )}

        {/* Summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <SummaryStat label="Passed" value={`${summary.passed}/${summary.total}`}
              color={summary.failed === 0 && summary.total > 0 ? Colors.healthGreen : colors.text}
              styles={styles} />
            <SummaryStat label="Failed" value={String(summary.failed)}
              color={summary.failed > 0 ? Colors.errorRed : colors.textMuted} styles={styles} />
            <SummaryStat label="Avg latency" value={`${(summary.avgLatencyMs / 1000).toFixed(1)}s`}
              color={colors.text} styles={styles} />
            <SummaryStat label="Max latency" value={`${(summary.maxLatencyMs / 1000).toFixed(1)}s`}
              color={colors.text} styles={styles} />
          </View>
          <TouchableOpacity
            style={[styles.runBtn, (running || !aiReachable) && styles.runBtnDisabled]}
            onPress={runAll}
            disabled={running || !aiReachable}
          >
            {running ? (
              <View style={styles.runningRow}>
                <ActivityIndicator color={Colors.white} size="small" />
                <Text style={styles.runBtnText}>
                  Running {results.length + 1}/{GOLDEN_SET.length}
                  {currentId ? ` · ${currentId}` : ''}
                </Text>
              </View>
            ) : (
              <Text style={styles.runBtnText}>
                {results.length > 0 ? 'Run again' : `Run all ${GOLDEN_SET.length} cases`}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Results */}
        {results.map((r) => {
          const isOpen = expanded.has(r.caseId)
          return (
            <View key={r.caseId} style={styles.caseCard}>
              <TouchableOpacity style={styles.caseHeader} onPress={() => toggle(r.caseId)}>
                <View style={[styles.verdict, { backgroundColor: r.passed ? Colors.healthGreen : Colors.errorRed }]}>
                  <Text style={styles.verdictText}>{r.passed ? '✓' : '✗'}</Text>
                </View>
                <View style={styles.caseInfo}>
                  <Text style={styles.caseTitle} numberOfLines={1}>{r.title}</Text>
                  <View style={styles.caseMeta}>
                    <View style={[styles.chip, { backgroundColor: `${CATEGORY_COLOR[r.category]}22` }]}>
                      <Text style={[styles.chipText, { color: CATEGORY_COLOR[r.category] }]}>
                        {r.category}
                      </Text>
                    </View>
                    <Text style={styles.caseMetaText}>
                      {(r.observation.latencyMs / 1000).toFixed(1)}s ·{' '}
                      {r.checks.filter((c) => c.passed).length}/{r.checks.length} checks
                    </Text>
                  </View>
                </View>
                <Text style={styles.chevron}>{isOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {isOpen && (
                <View style={styles.caseBody}>
                  {r.checks.map((c, i) => (
                    <Text
                      key={i}
                      style={[styles.checkLine, { color: c.passed ? Colors.healthGreen : Colors.errorRed }]}
                    >
                      {c.passed ? '✓' : '✗'} {c.label}
                      {c.detail ? <Text style={styles.checkDetail}> — {c.detail}</Text> : null}
                    </Text>
                  ))}
                  <Text style={styles.reviewNote}>🔎 Review: {r.reviewNote}</Text>
                  <Text style={styles.replyLabel}>Model reply</Text>
                  <Text style={styles.replyText} selectable>
                    {r.observation.reply || '(empty)'}
                  </Text>
                </View>
              )}
            </View>
          )
        })}

        {results.length === 0 && !running && (
          <Text style={styles.emptyHint}>No run yet — tap “Run all” to start.</Text>
        )}
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  )
}

function SummaryStat({
  label, value, color, styles,
}: { label: string; value: string; color: string; styles: EvalStyles }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

type EvalStyles = ReturnType<typeof makeStyles>

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
    devOnly: { ...Typography.body, color: colors.textMuted, textAlign: 'center' },
    scroll: { padding: Spacing.md },
    intro: { ...Typography.caption, color: colors.textSecondary, marginBottom: Spacing.sm },
    banner: { borderRadius: BorderRadius.md, padding: Spacing.sm, marginBottom: Spacing.sm },
    bannerError: { backgroundColor: `${Colors.errorRed}18` },
    bannerWarn: { backgroundColor: `${Colors.goldenAmber}18` },
    bannerText: { ...Typography.caption, color: colors.text },
    summaryCard: {
      backgroundColor: colors.surface, borderRadius: BorderRadius.lg,
      padding: Spacing.md, marginBottom: Spacing.sm,
    },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.sm },
    stat: { alignItems: 'center', flex: 1 },
    statValue: { ...Typography.heading3 },
    statLabel: { ...Typography.caption, color: colors.textMuted, marginTop: 2 },
    runBtn: {
      backgroundColor: Colors.healthGreen, borderRadius: BorderRadius.pill,
      paddingVertical: Spacing.sm, alignItems: 'center',
    },
    runBtnDisabled: { backgroundColor: colors.border },
    runBtnText: { ...Typography.bodyLarge, color: Colors.white, fontFamily: Typography.heading3.fontFamily },
    runningRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    caseCard: {
      backgroundColor: colors.surface, borderRadius: BorderRadius.md,
      marginBottom: Spacing.xs, overflow: 'hidden',
    },
    caseHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm },
    verdict: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    verdictText: { color: Colors.white, fontFamily: Typography.heading3.fontFamily, fontSize: 14 },
    caseInfo: { flex: 1, minWidth: 0 },
    caseTitle: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily },
    caseMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 2 },
    chip: { paddingHorizontal: Spacing.xs, paddingVertical: 1, borderRadius: BorderRadius.pill },
    chipText: { ...Typography.caption, fontSize: 10 },
    caseMetaText: { ...Typography.caption, color: colors.textMuted },
    chevron: { fontSize: 11, color: colors.textMuted },
    caseBody: {
      paddingHorizontal: Spacing.sm, paddingBottom: Spacing.sm, gap: 3,
      borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: Spacing.sm,
    },
    checkLine: { ...Typography.caption },
    checkDetail: { color: colors.textMuted },
    reviewNote: {
      ...Typography.caption, color: colors.textSecondary, marginTop: Spacing.xs,
      fontStyle: 'italic',
    },
    replyLabel: {
      ...Typography.caption, color: colors.textMuted, marginTop: Spacing.xs,
      fontFamily: Typography.heading3.fontFamily,
    },
    replyText: {
      ...Typography.caption, color: colors.text,
      backgroundColor: colors.background, borderRadius: BorderRadius.sm, padding: Spacing.sm,
    },
    emptyHint: { ...Typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: Spacing.lg },
  })
}
