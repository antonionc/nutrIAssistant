import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react'
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../theme'
import { useTheme, ThemeColors } from '../../theme/ThemeContext'
import { useProfiles } from '../../modules/profiles/ProfilesContext'
import { useSelectedProfile } from '../../modules/profiles/SelectedProfileContext'
import { getMemberAvatarSource } from '../../services/avatarService'
import { logger } from '../../utils/logger'

let BottomSheet: any = null
let BottomSheetScrollView: any = null
try {
  const bs = require('@gorhom/bottom-sheet')
  BottomSheet = bs.default
  BottomSheetScrollView = bs.BottomSheetScrollView
} catch {
  logger.info('[ProfileSelectorSheet] @gorhom/bottom-sheet no disponible')
}

export interface ProfileSelectorSheetRef {
  present: () => void
  dismiss: () => void
}

const ROLE_LABEL: Record<string, string> = {
  father: 'Padre',
  mother: 'Madre',
  son: 'Hijo',
  daughter: 'Hija',
  other: 'Otro',
}

export const ProfileSelectorSheet = forwardRef<ProfileSelectorSheetRef>(
  function ProfileSelectorSheet(_props, ref) {
    const { colors } = useTheme()
    const { profiles } = useProfiles()
    const { selectedId, select } = useSelectedProfile()
    const styles = useMemo(() => makeStyles(colors), [colors])
    const sheetRef = useRef<any>(null)

    useImperativeHandle(ref, () => ({
      present: () => sheetRef.current?.expand(),
      dismiss: () => sheetRef.current?.close(),
    }))

    if (!BottomSheet) return null

    return (
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={['60%']}
        enablePanDownToClose
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handle}
        enableDynamicSizing={false}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Ionicons name="people" size={20} color={Colors.healthGreen} />
            <Text style={styles.title}>Cambiar de perfil</Text>
          </View>

          <BottomSheetScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {profiles.map((m) => {
              const isCurrent = m.id === selectedId
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.row, isCurrent && styles.rowActive]}
                  onPress={() => {
                    select(m.id)
                    sheetRef.current?.close()
                  }}
                  activeOpacity={0.85}
                >
                  <Image source={getMemberAvatarSource(m)} style={styles.avatar} />
                  <View style={styles.rowText}>
                    <View style={styles.nameLine}>
                      <Text style={styles.name} numberOfLines={1}>
                        {m.name}
                      </Text>
                      {m.isSuperUser ? (
                        <View style={styles.adminPill}>
                          <Text style={styles.adminPillText}>Admin</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.meta} numberOfLines={1}>
                      {ROLE_LABEL[m.role] ?? m.role}
                    </Text>
                  </View>
                  {isCurrent ? (
                    <Ionicons name="checkmark-circle" size={22} color={Colors.healthGreen} />
                  ) : null}
                </TouchableOpacity>
              )
            })}

            <View style={{ height: Spacing.xl }} />
          </BottomSheetScrollView>
        </View>
      </BottomSheet>
    )
  }
)

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
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.sm,
      marginBottom: Spacing.sm,
      ...Shadows.subtle,
    },
    rowActive: {
      borderWidth: 2,
      borderColor: Colors.healthGreen,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: BorderRadius.circle,
    },
    rowText: { flex: 1 },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    name: {
      ...Typography.heading3,
      color: colors.text,
    },
    meta: { ...Typography.caption, color: colors.textSecondary, marginTop: 2 },
    adminPill: {
      backgroundColor: Colors.softMint,
      paddingHorizontal: Spacing.xs + 2,
      paddingVertical: 2,
      borderRadius: BorderRadius.pill,
    },
    adminPillText: {
      ...Typography.caption,
      color: Colors.forestGreen,
      fontFamily: Typography.heading3.fontFamily,
    },
  })
}
