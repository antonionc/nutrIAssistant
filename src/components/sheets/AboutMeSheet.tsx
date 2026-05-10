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
  Alert,
  Keyboard,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Typography, Spacing, BorderRadius } from '../../theme'
import { useTheme, ThemeColors } from '../../theme/ThemeContext'
import { FamilyMember } from '../../types/profiles'
import { useProfiles } from '../../modules/profiles/ProfilesContext'
import { useTranslation } from '../../i18n'

let BottomSheet: any = null
let BottomSheetTextInput: any = null
let BottomSheetScrollView: any = null
try {
  const bs = require('@gorhom/bottom-sheet')
  BottomSheet = bs.default
  BottomSheetTextInput = bs.BottomSheetTextInput
  BottomSheetScrollView = bs.BottomSheetScrollView
} catch {
  // Expo Go fallback handled below
}

const MAX_LEN = 500

export interface AboutMeSheetRef {
  present: () => void
  dismiss: () => void
}

interface Props {
  member: FamilyMember
}

export const AboutMeSheet = forwardRef<AboutMeSheetRef, Props>(function AboutMeSheet(
  { member },
  ref
) {
  const { colors } = useTheme()
  const { updateProfile } = useProfiles()
  const tr = useTranslation()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const sheetRef = useRef<any>(null)
  const [text, setText] = useState(member.aboutMeNotes ?? '')
  const [saving, setSaving] = useState(false)

  // Re-sync local state when the underlying member's notes change (e.g. after
  // we save, the parent re-renders us with the new notes).
  useEffect(() => {
    setText(member.aboutMeNotes ?? '')
  }, [member.aboutMeNotes])

  useImperativeHandle(ref, () => ({
    present: () => sheetRef.current?.expand(),
    dismiss: () => sheetRef.current?.close(),
  }))

  const handleSave = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      await updateProfile(member.id, { aboutMeNotes: text.trim() })
      Keyboard.dismiss()
      sheetRef.current?.close()
    } catch (e) {
      Alert.alert(tr.app.error, e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [member.id, text, updateProfile, saving, tr.app.error])

  if (!BottomSheet) return null

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={['65%']}
      enablePanDownToClose
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
      enableDynamicSizing={false}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="person-circle-outline" size={20} color={colors.text} />
          <Text style={styles.title}>{tr.aboutMe.title}</Text>
        </View>

        <BottomSheetScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.hint}>{tr.aboutMe.description}</Text>

          <BottomSheetTextInput
            style={styles.input}
            multiline
            placeholder={tr.aboutMe.placeholder}
            placeholderTextColor={colors.textMuted}
            value={text}
            onChangeText={(t: string) => setText(t.slice(0, MAX_LEN))}
            maxLength={MAX_LEN}
            textAlignVertical="top"
          />

          <Text style={styles.charCount}>{tr.aboutMe.charCount(text.length)}</Text>

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={styles.saveBtnText}>{tr.aboutMe.saveBtn}</Text>
          </TouchableOpacity>
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
    input: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.md,
      minHeight: 160,
      ...Typography.body,
      color: colors.text,
    },
    charCount: {
      ...Typography.caption,
      color: colors.textSecondary,
      textAlign: 'right',
      marginTop: Spacing.xs,
    },
    saveBtn: {
      marginTop: Spacing.lg,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: Colors.healthGreen,
      alignItems: 'center',
    },
    saveBtnDisabled: { opacity: 0.6 },
    saveBtnText: {
      ...Typography.body,
      color: Colors.white,
      fontFamily: Typography.heading3.fontFamily,
    },
  })
}
