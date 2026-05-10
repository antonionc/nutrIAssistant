import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../theme'
import { useTheme, ThemeColors } from '../../theme/ThemeContext'
import { FamilyMember } from '../../types/profiles'
import { useTranslation } from '../../i18n'
import {
  MemberMemory,
  deleteMemberMemory,
  listMemberMemories,
} from '../../services/memoryStore'

let BottomSheet: any = null
let BottomSheetScrollView: any = null
try {
  const bs = require('@gorhom/bottom-sheet')
  BottomSheet = bs.default
  BottomSheetScrollView = bs.BottomSheetScrollView
} catch {
  // Expo Go fallback
}

export interface MemorySheetRef {
  present: () => void
  dismiss: () => void
}

interface Props {
  member: FamilyMember
  // Called after the user mutates the memory list (delete). The profile
  // screen uses this to refresh its tile count without polling.
  onChanged?: () => void
}

export const MemorySheet = forwardRef<MemorySheetRef, Props>(function MemorySheet(
  { member, onChanged },
  ref
) {
  const { colors } = useTheme()
  const tr = useTranslation()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const sheetRef = useRef<any>(null)
  const [memories, setMemories] = useState<MemberMemory[]>([])
  const [loading, setLoading] = useState(false)
  const [visible, setVisible] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listMemberMemories(member.id)
      setMemories(list)
    } finally {
      setLoading(false)
    }
  }, [member.id])

  // Refresh whenever the sheet is opened. Memories may have been added by
  // the assistant since the last open.
  useEffect(() => {
    if (visible) refresh()
  }, [visible, refresh])

  useImperativeHandle(ref, () => ({
    present: () => {
      setVisible(true)
      sheetRef.current?.expand()
    },
    dismiss: () => sheetRef.current?.close(),
  }))

  const handleDelete = useCallback(
    (mem: MemberMemory) => {
      Alert.alert(
        tr.memories.deleteConfirm,
        mem.text,
        [
          { text: tr.memories.cancel, style: 'cancel' },
          {
            text: tr.memories.delete,
            style: 'destructive',
            onPress: async () => {
              await deleteMemberMemory(mem.id)
              setMemories((prev) => prev.filter((m) => m.id !== mem.id))
              onChanged?.()
            },
          },
        ]
      )
    },
    [tr.memories, onChanged]
  )

  if (!BottomSheet) return null

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={['65%']}
      enablePanDownToClose
      onClose={() => setVisible(false)}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
      enableDynamicSizing={false}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="bookmark-outline" size={20} color={colors.text} />
          <Text style={styles.title}>{tr.memories.title}</Text>
        </View>

        <BottomSheetScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.hint}>{tr.memories.description}</Text>

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={Colors.forestGreen} />
            </View>
          ) : memories.length === 0 ? (
            <Text style={styles.empty}>{tr.memories.empty}</Text>
          ) : (
            memories.map((mem) => (
              <View key={mem.id} style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.categoryLabel}>
                    {(tr.memories.categoryLabels as Record<string, string>)[mem.category] ?? mem.category}
                  </Text>
                  <Text style={styles.text}>{mem.text}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDelete(mem)}
                  style={styles.deleteBtn}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={18} color={Colors.errorRed} />
                </TouchableOpacity>
              </View>
            ))
          )}
          <View style={{ height: Spacing.xl }} />
        </BottomSheetScrollView>
      </View>
    </BottomSheet>
  )
})

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.background,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
    },
    handle: { backgroundColor: colors.border, width: 40 },
    container: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { ...Typography.heading2, color: colors.text },
    scrollContent: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
    hint: { ...Typography.body, color: colors.textSecondary, marginBottom: Spacing.md },
    empty: { ...Typography.body, color: colors.textMuted, paddingVertical: Spacing.lg, textAlign: 'center' },
    loadingRow: { paddingVertical: Spacing.lg, alignItems: 'center' },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
      gap: Spacing.sm,
      ...Shadows.subtle,
    },
    rowMain: { flex: 1, gap: 4 },
    categoryLabel: {
      ...Typography.caption,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    text: { ...Typography.body, color: colors.text, lineHeight: 20 },
    deleteBtn: { padding: Spacing.xs },
  })
}
