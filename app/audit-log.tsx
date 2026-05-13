import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { getRecentAuditEntries, AuditEntry, AuditEventType } from '../src/services/auditLog'
import { useTranslation } from '../src/i18n'
import { Colors, Typography, Spacing, BorderRadius } from '../src/theme'
import { useTheme, ThemeColors } from '../src/theme/ThemeContext'

/**
 * GDPR Art. 15 transparency surface — lets the user see, on-device,
 * every privacy-relevant operation the app has performed, in plain
 * language. No JSON, no internal event names — each row is one
 * human-readable sentence + relative timestamp + an icon by category.
 */

type CategoryKey = 'consent' | 'erasure' | 'export' | 'documents' | 'security' | 'automatic'

// Map every audit event type to a UI category. Adding a new event type
// requires choosing one of these so the filter chips don't drift.
const EVENT_CATEGORY: Record<AuditEventType, CategoryKey> = {
  consent_granted: 'consent',
  consent_revoked: 'consent',
  parental_consent_granted: 'consent',
  erasure_started: 'erasure',
  erasure_completed: 'erasure',
  export_generated: 'export',
  pdf_uploaded: 'documents',
  key_rotation_started: 'security',
  key_rotation_completed: 'security',
  decrypt_failure: 'security',
  retention_sweep_executed: 'automatic',
}

const PAGE_SIZE = 100

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function describeEvent(
  entry: AuditEntry,
  tr: ReturnType<typeof useTranslation>,
): string {
  const t = tr.auditLog.events
  const p = entry.payload
  switch (entry.eventType) {
    case 'consent_granted': {
      const toggle = p.toggle as string | undefined
      if (toggle === 'health') return t.consent_granted.health
      if (toggle === 'ai') return t.consent_granted.ai
      if (toggle === 'documents') return t.consent_granted.documents
      return t.consent_granted.unknown
    }
    case 'consent_revoked': {
      const toggle = p.toggle as string | undefined
      if (toggle === 'health') return t.consent_revoked.health
      if (toggle === 'ai') return t.consent_revoked.ai
      if (toggle === 'documents') return t.consent_revoked.documents
      return t.consent_revoked.unknown
    }
    case 'erasure_started':
      return t.erasure_started
    case 'erasure_completed': {
      const failures = (p.partialFailures as unknown[] | undefined) ?? []
      return failures.length === 0
        ? t.erasure_completed_clean
        : t.erasure_completed_partial(failures.length)
    }
    case 'export_generated': {
      const bytes = (p.bytes as number | undefined) ?? 0
      return t.export_generated(formatBytes(bytes))
    }
    case 'pdf_uploaded': {
      const category = p.category as string | undefined
      if (category === 'lab_report') return t.pdf_uploaded.lab_report
      if (category === 'medical_history') return t.pdf_uploaded.medical_history
      if (category === 'prescription') return t.pdf_uploaded.prescription
      if (category === 'other') return t.pdf_uploaded.other
      return t.pdf_uploaded.unknown
    }
    case 'key_rotation_started':
      return t.key_rotation_started
    case 'key_rotation_completed':
      return t.key_rotation_completed
    case 'decrypt_failure':
      return t.decrypt_failure
    case 'parental_consent_granted': {
      const age = (p.age as number | undefined) ?? 0
      return t.parental_consent_granted(age)
    }
    case 'retention_sweep_executed': {
      const counts = (p.deletedCounts as Record<string, number> | undefined) ?? {}
      const total = Object.values(counts).reduce((a, b) => a + Math.max(0, b), 0)
      return total === 0
        ? t.retention_sweep_executed_empty
        : t.retention_sweep_executed(total)
    }
    default:
      return t.unknown(entry.eventType)
  }
}

function formatRelative(ts: number, tr: ReturnType<typeof useTranslation>): string {
  const now = Date.now()
  const diffMs = now - ts
  const diffMin = Math.floor(diffMs / 60_000)
  const diffH = Math.floor(diffMs / 3_600_000)

  if (diffMin < 1) return tr.auditLog.timeJustNow
  if (diffMin < 60) return tr.auditLog.timeMinutesAgo(diffMin)
  if (diffH < 6) return tr.auditLog.timeHoursAgo(diffH)

  const d = new Date(ts)
  const hhmm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  if (isToday) return tr.auditLog.timeToday(hhmm)

  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  if (isYesterday) return tr.auditLog.timeYesterday(hhmm)

  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' + hhmm
}

export default function AuditLogScreen() {
  const { colors } = useTheme()
  const tr = useTranslation()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<CategoryKey | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const rows = await getRecentAuditEntries(PAGE_SIZE)
      setEntries(rows)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const visibleEntries = useMemo(() => {
    if (!filter) return entries
    return entries.filter((e) => EVENT_CATEGORY[e.eventType] === filter)
  }, [entries, filter])

  const renderEntry = useCallback(
    ({ item }: { item: AuditEntry }) => (
      <View style={styles.row}>
        <Text style={styles.description}>{describeEvent(item, tr)}</Text>
        <Text style={styles.timestamp}>{formatRelative(item.ts, tr)}</Text>
      </View>
    ),
    [styles, tr],
  )

  const filters: Array<{ key: CategoryKey | null; label: string }> = [
    { key: null, label: tr.auditLog.filterAll },
    { key: 'consent', label: tr.auditLog.filters.consent },
    { key: 'erasure', label: tr.auditLog.filters.erasure },
    { key: 'export', label: tr.auditLog.filters.export },
    { key: 'documents', label: tr.auditLog.filters.documents },
    { key: 'security', label: tr.auditLog.filters.security },
    { key: 'automatic', label: tr.auditLog.filters.automatic },
  ]

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>{tr.auditLog.title}</Text>
        <Text style={styles.subtitle}>{tr.auditLog.subtitle}</Text>
      </View>

      <View style={styles.filterRow}>
        <FlatList
          data={filters}
          keyExtractor={(f) => f.key ?? 'all'}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipScroll}
          renderItem={({ item }) => {
            const isActive = filter === item.key
            return (
              <TouchableOpacity
                onPress={() => setFilter(item.key)}
                style={[
                  styles.chip,
                  isActive && { backgroundColor: Colors.healthGreen, borderColor: Colors.healthGreen },
                ]}
              >
                <Text style={[styles.chipText, isActive && { color: Colors.white }]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            )
          }}
        />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.healthGreen} />
        </View>
      ) : visibleEntries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>{tr.auditLog.empty}</Text>
        </View>
      ) : (
        <FlatList
          data={visibleEntries}
          keyExtractor={(e) => String(e.id)}
          renderItem={renderEntry}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm, gap: 4 },
    title: { ...Typography.heading2, color: colors.text },
    subtitle: { ...Typography.caption, color: colors.textSecondary },
    filterRow: { paddingVertical: Spacing.sm },
    chipScroll: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
    chip: {
      paddingHorizontal: Spacing.md,
      paddingVertical: 6,
      borderRadius: BorderRadius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: Spacing.sm,
    },
    chipText: { ...Typography.caption, color: colors.text },
    listContent: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
    // One row per event — single line of plain text + a small timestamp
    // on the right. Separator between rows, no cards, no icons.
    row: {
      paddingVertical: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    description: { ...Typography.body, color: colors.text, flex: 1, lineHeight: 20 },
    timestamp: { ...Typography.caption, color: colors.textMuted, fontSize: 11 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
    empty: { ...Typography.body, color: colors.textMuted, textAlign: 'center' },
  })
}
