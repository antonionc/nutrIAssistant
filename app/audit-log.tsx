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
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../src/theme'
import { useTheme, ThemeColors } from '../src/theme/ThemeContext'

/**
 * GDPR Art. 15 transparency surface — lets the user see, on-device and in
 * cleartext, every privacy-relevant operation the app has performed. Data
 * is read fresh from the `audit_log` table on every screen mount; we do
 * NOT poll. Reads are cheap (50 rows, indexed by ts DESC) so a pull-to-
 * refresh-style update is enough.
 *
 * The filter chips toggle on a single event type. There is no "all" chip
 * because the default unfiltered view IS "all".
 */
const FILTER_TYPES: AuditEventType[] = [
  'consent_granted',
  'consent_revoked',
  'erasure_started',
  'erasure_completed',
  'export_generated',
  'pdf_uploaded',
  'decrypt_failure',
  'parental_consent_granted',
  'key_rotation_started',
  'key_rotation_completed',
  'retention_sweep_executed',
]

const PAGE_SIZE = 50

export default function AuditLogScreen() {
  const { colors } = useTheme()
  const tr = useTranslation()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<AuditEventType | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const rows = await getRecentAuditEntries(PAGE_SIZE, filter ?? undefined)
      setEntries(rows)
    } finally {
      setIsLoading(false)
    }
  }, [filter])

  useEffect(() => {
    refresh()
  }, [refresh])

  const renderEntry = useCallback(
    ({ item }: { item: AuditEntry }) => (
      <View style={styles.row}>
        <View style={styles.rowHeader}>
          <Text style={styles.eventType}>{item.eventType}</Text>
          <Text style={styles.timestamp}>{new Date(item.ts).toLocaleString()}</Text>
        </View>
        <Text style={styles.actorLine}>
          {tr.auditLog.actorLabel(item.actor)} · {tr.auditLog.appVersionLabel(item.appVersion)}
        </Text>
        {Object.keys(item.payload).length > 0 ? (
          <Text style={styles.payload} numberOfLines={4}>
            {JSON.stringify(item.payload, null, 2)}
          </Text>
        ) : null}
      </View>
    ),
    [styles, tr],
  )

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>{tr.auditLog.title}</Text>
        <Text style={styles.subtitle}>{tr.auditLog.subtitle}</Text>
      </View>

      <View style={styles.filterRow}>
        <FlatList
          data={[null as AuditEventType | null, ...FILTER_TYPES]}
          keyExtractor={(t) => t ?? 'all'}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipScroll}
          renderItem={({ item }) => {
            const isActive = filter === item
            return (
              <TouchableOpacity
                onPress={() => setFilter(item)}
                style={[
                  styles.chip,
                  isActive && { backgroundColor: Colors.healthGreen, borderColor: Colors.healthGreen },
                ]}
              >
                <Text style={[styles.chipText, isActive && { color: Colors.white }]}>
                  {item ?? tr.auditLog.filterAll}
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
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>{tr.auditLog.empty}</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
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
    listContent: { padding: Spacing.lg, gap: Spacing.sm },
    row: {
      backgroundColor: colors.cardBackground,
      padding: Spacing.md,
      borderRadius: BorderRadius.lg,
      gap: 4,
      ...Shadows.subtle,
    },
    rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.sm },
    eventType: { ...Typography.body, color: Colors.healthGreen, fontFamily: Typography.heading3.fontFamily },
    timestamp: { ...Typography.caption, color: colors.textMuted, fontSize: 11 },
    actorLine: { ...Typography.caption, color: colors.textSecondary, fontSize: 11 },
    payload: { ...Typography.caption, color: colors.textSecondary, fontFamily: 'monospace', fontSize: 11 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
    empty: { ...Typography.body, color: colors.textMuted, textAlign: 'center' },
  })
}
