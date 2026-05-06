import React, { useMemo, useRef } from 'react'
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../src/theme'
import { useTheme, ThemeColors } from '../../src/theme/ThemeContext'
import { useProfiles } from '../../src/modules/profiles/ProfilesContext'
import { useTranslation } from '../../src/i18n'
import { getAge } from '../../src/utils/ageUtils'
import { getMemberAvatarSource } from '../../src/services/avatarService'
import { ProgressRing } from '../../src/components/charts/ProgressRing'
import { AllergyPill } from '../../src/components/badges/AllergyPill'
import { FavoritesSheet, FavoritesSheetRef } from '../../src/components/sheets/FavoritesSheet'
import { DocumentsSheet, DocumentsSheetRef } from '../../src/components/sheets/DocumentsSheet'

// Custom pill back button shared by both render branches. Replaces the
// default iOS pill that leaks the parent route name ("(tabs)") as a label.
function CircleBackButton({ tint, bg }: { tint: string; bg: string }) {
  return (
    <TouchableOpacity
      onPress={() => router.back()}
      style={[circleBackStyles.btn, { backgroundColor: bg }]}
      hitSlop={8}
      accessibilityLabel="Volver"
    >
      <Ionicons name="chevron-back" size={20} color={tint} />
      <Text style={[circleBackStyles.label, { color: tint }]}>Volver</Text>
    </TouchableOpacity>
  )
}

const circleBackStyles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingLeft: Spacing.xs,
    paddingRight: Spacing.md,
    borderRadius: 18,
    marginLeft: Spacing.xs,
    gap: 2,
  },
  label: {
    ...Typography.body,
    fontFamily: Typography.heading3.fontFamily,
  },
})

export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { profiles } = useProfiles()
  const { colors } = useTheme()
  const tr = useTranslation()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const favRef = useRef<FavoritesSheetRef>(null)
  const docRef = useRef<DocumentsSheetRef>(null)

  const stackOptions = useMemo(
    () => ({
      title: '',
      headerTransparent: true,
      headerShadowVisible: false,
      headerBackVisible: false,
      headerLeft: () => <CircleBackButton tint={colors.text} bg={colors.surface} />,
    }),
    [colors.text, colors.surface]
  )

  const member = profiles.find((p) => p.id === id)

  if (!member) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={stackOptions} />
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>Perfil no encontrado.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>Volver</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  const age = getAge(member.dateOfBirth)
  const target = member.dailyCalorieTarget ?? 2000
  const dietLabel = (tr.diets as Record<string, string>)[member.dietPreference] ?? ''
  const roleLabel = tr.roles[member.role] ?? member.role

  const documentReadyCount = member.documents.filter((d) => d.aiSummaryStatus === 'ready').length

  // Header is transparent → push hero content below the navigation bar so the
  // name doesn't collide with the back button. ~44pt is the standard navbar
  // content height on iOS; add a bit of breathing room below it.
  const heroTopPadding = insets.top + 44 + Spacing.md

  return (
    <View style={styles.container}>
      <Stack.Screen options={stackOptions} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Hero band ───────────────────────── */}
        <View style={[styles.hero, { paddingTop: heroTopPadding }]}>
          <View style={styles.heroText}>
            <Text style={styles.heroName}>{member.name}</Text>
            <Text style={styles.heroMeta}>
              {roleLabel} · {tr.home_screen.yearsOld(age)}{dietLabel ? ` · ${dietLabel}` : ''}
            </Text>
          </View>
          <View style={styles.heroAvatarShadow}>
            <Image source={getMemberAvatarSource(member)} style={styles.heroAvatar} />
          </View>
        </View>

        {/* ── Calorie ring + targets ──────────── */}
        <View style={styles.ringCard}>
          <ProgressRing
            value={0}
            max={target}
            size={120}
            strokeWidth={8}
            color={Colors.goldenAmber}
            trackColor={`${Colors.healthGreen}22`}
            animate
          />
          <View style={styles.ringInfo}>
            <Text style={styles.ringTitle}>Objetivo diario</Text>
            <Text style={styles.ringValue}>{target} kcal</Text>
            {member.macroTargets && (
              <View style={styles.macroRow}>
                <MacroChip label="P" value={member.macroTargets.protein} color={Colors.healthGreen} />
                <MacroChip label="C" value={member.macroTargets.carbs} color={Colors.goldenAmber} />
                <MacroChip label="G" value={member.macroTargets.fat} color={Colors.warningOrange} />
              </View>
            )}
          </View>
        </View>

        {/* ── Two-card row: Favoritos + Informes ─ */}
        <View style={styles.tilesRow}>
          <TouchableOpacity
            style={styles.tile}
            onPress={() => favRef.current?.present()}
            activeOpacity={0.85}
          >
            <View style={[styles.tileIcon, { backgroundColor: `${Colors.errorRed}18` }]}>
              <Ionicons name="heart" size={20} color={Colors.errorRed} />
            </View>
            <Text style={styles.tileTitle}>Favoritos</Text>
            <Text style={styles.tileSub}>
              {member.favoriteRecipeIds.length} receta{member.favoriteRecipeIds.length === 1 ? '' : 's'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tile}
            onPress={() => docRef.current?.present()}
            activeOpacity={0.85}
          >
            <View style={[styles.tileIcon, { backgroundColor: `${Colors.forestGreen}18` }]}>
              <Ionicons name="document-text-outline" size={20} color={Colors.forestGreen} />
            </View>
            <Text style={styles.tileTitle}>Informes</Text>
            <Text style={styles.tileSub}>
              {member.documents.length} documento{member.documents.length === 1 ? '' : 's'}
              {member.documents.length > documentReadyCount && member.documents.length > 0
                ? ' · procesando…'
                : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Allergies ───────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Alergias e intolerancias</Text>
          {member.allergies.length === 0 ? (
            <Text style={styles.sectionEmpty}>Sin alergias registradas.</Text>
          ) : (
            <View style={styles.pillRow}>
              {member.allergies.map((a) => (
                <AllergyPill
                  key={a}
                  label={(tr.allergens as Record<string, string>)[a] ?? a}
                  tone="allergy"
                />
              ))}
            </View>
          )}
        </View>

        {/* ── Conditions ──────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Condiciones médicas</Text>
          {member.conditions.length === 0 ? (
            <Text style={styles.sectionEmpty}>Sin condiciones registradas.</Text>
          ) : (
            <View style={styles.pillRow}>
              {member.conditions.map((c) => (
                <AllergyPill key={c} label={c} tone="condition" />
              ))}
            </View>
          )}
        </View>

        {/* ── Vitals ──────────────────────────── */}
        <Vitals member={member} styles={styles} />

        {/* ── Edit footer ─────────────────────── */}
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => router.push('/settings')}
          activeOpacity={0.85}
        >
          <Ionicons name="create-outline" size={18} color={colors.text} />
          <Text style={styles.editBtnText}>Editar perfil en Ajustes</Text>
        </TouchableOpacity>

        <View style={{ height: 120 }} />
      </ScrollView>

      <FavoritesSheet ref={favRef} member={member} />
      <DocumentsSheet ref={docRef} member={member} />
    </View>
  )
}

function MacroChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[macroChipStyles.chip, { backgroundColor: `${color}18` }]}>
      <View style={[macroChipStyles.dot, { backgroundColor: color }]} />
      <Text style={[macroChipStyles.text, { color }]}>{label} {value}g</Text>
    </View>
  )
}

const macroChipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.pill,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { ...Typography.caption, fontFamily: Typography.heading3.fontFamily },
})

function Vitals({
  member,
  styles,
}: {
  member: { weight: number; height: number; bloodPressure?: string; restingHeartRate?: number; hrv?: number; spO2?: number }
  styles: ReturnType<typeof makeStyles>
}) {
  const items: Array<{ label: string; value: string }> = []
  if (member.weight) items.push({ label: 'Peso', value: `${member.weight} kg` })
  if (member.height) items.push({ label: 'Altura', value: `${member.height} cm` })
  if (member.bloodPressure) items.push({ label: 'Tensión', value: member.bloodPressure })
  if (member.restingHeartRate) items.push({ label: 'FC reposo', value: `${member.restingHeartRate} bpm` })
  if (member.hrv) items.push({ label: 'HRV', value: `${member.hrv} ms` })
  if (member.spO2) items.push({ label: 'SpO₂', value: `${member.spO2} %` })

  if (items.length === 0) return null

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Métricas</Text>
      <View style={styles.vitalsGrid}>
        {items.map((item) => (
          <View key={item.label} style={styles.vitalTile}>
            <Text style={styles.vitalLabel}>{item.label}</Text>
            <Text style={styles.vitalValue}>{item.value}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingBottom: Spacing.xl },

    notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.lg },
    notFoundText: { ...Typography.body, color: colors.textSecondary },
    backBtn: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.pill,
      backgroundColor: Colors.healthGreen,
    },
    backBtnText: { ...Typography.body, color: Colors.white, fontFamily: Typography.heading3.fontFamily },

    // Hero — paddingTop is set inline at runtime so the name clears the
    // transparent navigation header. See heroTopPadding in ProfileScreen.
    hero: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.lg,
      backgroundColor: colors.warmSurface,
      gap: Spacing.md,
    },
    heroText: { flex: 1, gap: 4 },
    heroName: { ...Typography.displaySerif, color: colors.text },
    heroMeta: { ...Typography.body, color: colors.textSecondary },
    heroAvatarShadow: {
      borderRadius: 48,
      ...Shadows.card,
    },
    heroAvatar: {
      width: 96,
      height: 96,
      borderRadius: 48,
      borderWidth: 3,
      borderColor: colors.background,
    },

    // Ring card
    ringCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.lg,
      backgroundColor: colors.surface,
      marginHorizontal: Spacing.md,
      marginTop: Spacing.lg,
      padding: Spacing.lg,
      borderRadius: BorderRadius.xl,
      ...Shadows.card,
    },
    ringInfo: { flex: 1, gap: 4 },
    ringTitle: { ...Typography.caption, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
    ringValue: { ...Typography.heading2, color: colors.text },
    macroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },

    // Tile row (Favorites + Documents)
    tilesRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      marginTop: Spacing.lg,
    },
    tile: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      gap: Spacing.xs,
      ...Shadows.subtle,
    },
    tileIcon: {
      width: 36, height: 36, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
      marginBottom: Spacing.xs,
    },
    tileTitle: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily },
    tileSub: { ...Typography.caption, color: colors.textSecondary },

    // Section
    section: { paddingHorizontal: Spacing.md, marginTop: Spacing.lg, gap: Spacing.sm },
    sectionTitle: { ...Typography.heading3, color: colors.text },
    sectionEmpty: { ...Typography.body, color: colors.textMuted },
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },

    // Vitals
    vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    vitalTile: {
      width: '31%',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.sm,
      alignItems: 'center',
      gap: 2,
      ...Shadows.subtle,
    },
    vitalLabel: { ...Typography.caption, color: colors.textSecondary },
    vitalValue: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily },

    // Edit
    editBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      marginHorizontal: Spacing.md,
      marginTop: Spacing.xl,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.warmSurface,
    },
    editBtnText: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily },
  })
}
