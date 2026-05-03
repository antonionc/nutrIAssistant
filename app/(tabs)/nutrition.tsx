import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { router } from 'expo-router'
import { usePlanner } from '../../src/modules/planner/PlannerContext'
import { useInventory } from '../../src/modules/inventory/InventoryContext'
import { useProfiles } from '../../src/modules/profiles/ProfilesContext'
import { useTranslation } from '../../src/i18n'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../src/theme'
import { useTheme, ThemeColors } from '../../src/theme/ThemeContext'
import { MealCard } from '../../src/components/cards/MealCard'
import { PillSelector, PillOption } from '../../src/components/inputs/PillSelector'
import { EmptyState } from '../../src/components/layout/EmptyState'
import { MealType } from '../../src/types/planner'
import { Recipe } from '../../src/types/recipes'
import { getRandomRecipes } from '../../src/modules/recipes/recipeDB'
import { MEAL_LABELS } from '../../src/constants/mealTypes'

function getDayOptions(): PillOption[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const day = d.toLocaleDateString('es-ES', { weekday: 'short' })
    const date = d.toLocaleDateString('es-ES', { day: 'numeric' })
    const id = d.toISOString().split('T')[0]
    return { id, label: day, sublabel: date }
  })
}

export default function NutritionScreen() {
  const { profiles } = useProfiles()
  const { items: inventory } = useInventory()
  const {
    weekPlans,
    isLoading,
    isGenerating,
    generateWeekPlan,
    lockDay,
    uploadSchoolMenu,
    setMealForDate,
  } = usePlanner()
  const { colors } = useTheme()
  const tr = useTranslation()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const dayOptions = getDayOptions()
  const todayStr = new Date().toISOString().split('T')[0]
  const [selectedDay, setSelectedDay] = useState(todayStr)
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'analyzing' | 'generating'>('idle')

  // Alternative suggestion sheet
  const [altSheet, setAltSheet] = useState<{
    visible: boolean
    mealType: MealType
    loading: boolean
    recipes: Recipe[]
  }>({ visible: false, mealType: 'lunch', loading: false, recipes: [] })

  const selectedPlan = weekPlans.find((p) => p.date === selectedDay)

  const handleGeneratePlan = useCallback(async () => {
    await generateWeekPlan(inventory)
  }, [generateWeekPlan, inventory])

  const handleSuggestAlternative = useCallback(async (mealType: MealType) => {
    setAltSheet({ visible: true, mealType, loading: true, recipes: [] })
    try {
      const alternatives = await getRandomRecipes(5, mealType)
      // Exclude the recipe already assigned to this slot
      const current = selectedPlan?.meals[mealType]
      const filtered = alternatives.filter((r) => r.id !== current?.id).slice(0, 4)
      setAltSheet((prev) => ({ ...prev, loading: false, recipes: filtered }))
    } catch {
      setAltSheet((prev) => ({ ...prev, loading: false }))
    }
  }, [selectedPlan])

  const handlePickAlternative = useCallback(async (recipe: Recipe) => {
    const mealType = altSheet.mealType
    setAltSheet((prev) => ({ ...prev, visible: false }))
    await setMealForDate(selectedDay, mealType, recipe)
  }, [altSheet.mealType, selectedDay, setMealForDate])

  const handleUploadSchoolMenu = useCallback(async () => {
    const schoolAgeMembers = profiles.filter((p) => p.isSchoolAge)
    if (schoolAgeMembers.length === 0) {
      Alert.alert(tr.nutrition.noSchoolAgeMembers, tr.nutrition.noSchoolAgeMembersDesc)
      return
    }

    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    })

    if (result.canceled || !result.assets?.[0]) return

    const file = result.assets[0]
    setUploadPhase('analyzing')
    try {
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: 'base64',
      })

      for (const member of schoolAgeMembers) {
        await uploadSchoolMenu(base64, member.id)
      }

      setUploadPhase('generating')
      await handleGeneratePlan()
      Alert.alert(tr.nutrition.uploadSuccess, tr.nutrition.uploadSuccessDesc)
    } catch (error) {
      Alert.alert(tr.nutrition.uploadFailed, error instanceof Error ? error.message : tr.app.error)
    } finally {
      setUploadPhase('idle')
    }
  }, [profiles, uploadSchoolMenu, handleGeneratePlan])

  const hasSchoolAgeMembers = profiles.some((p) => p.isSchoolAge)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{tr.nutrition.title}</Text>
        <TouchableOpacity
          style={[styles.generateBtn, isGenerating && styles.generateBtnDisabled]}
          onPress={handleGeneratePlan}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <ActivityIndicator color={Colors.white} size="small" />
          ) : (
            <Text style={styles.generateBtnText}>{tr.nutrition.generate}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Day Selector */}
      <PillSelector
        options={dayOptions}
        selectedId={selectedDay}
        onSelect={setSelectedDay}
        style={styles.pillSelectorContent}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* School Menu Upload Banner */}
        <TouchableOpacity
          style={styles.schoolBanner}
          onPress={handleUploadSchoolMenu}
          disabled={uploadPhase !== 'idle'}
        >
          {uploadPhase !== 'idle' ? (
            <View style={styles.uploadProgressContainer}>
              <View style={styles.uploadProgressHeader}>
                <ActivityIndicator color={Colors.healthGreen} size="small" />
                <Text style={styles.uploadStatusText}>
                  {uploadPhase === 'analyzing' ? tr.nutrition.analyzingMenu : tr.nutrition.generatingPlan}
                </Text>
              </View>
              <UploadProgressBar phase={uploadPhase} />
            </View>
          ) : (
            <>
              <Text style={styles.schoolBannerEmoji}>🏫</Text>
              <View style={styles.schoolBannerText}>
                <Text style={styles.schoolBannerTitle}>{tr.nutrition.uploadSchoolMenu}</Text>
                <Text style={styles.schoolBannerSub}>
                  {hasSchoolAgeMembers
                    ? tr.nutrition.uploadSchoolMenuSub
                    : tr.nutrition.noSchoolEnabledNote}
                </Text>
              </View>
              <Text style={styles.schoolBannerArrow}>→</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Meal Cards for selected day */}
        {isLoading ? (
          <ActivityIndicator color={Colors.healthGreen} style={styles.loader} />
        ) : (
          <View style={styles.mealsContainer}>
            {(['breakfast', 'lunch', 'dinner'] as MealType[]).map((mealType) => (
              <View key={mealType}>
                <MealCard
                  mealType={mealType}
                  recipe={selectedPlan?.meals[mealType]}
                  members={profiles}
                  isLocked={selectedPlan?.isLocked}
                  isGenerating={isGenerating}
                  onPress={() => {
                    const recipe = selectedPlan?.meals[mealType]
                    if (recipe) router.push(`/recipe/${recipe.id}`)
                  }}
                  onLock={() => lockDay(selectedDay)}
                  onSuggestAlternative={() => handleSuggestAlternative(mealType)}
                />

                {/* Supplement reminders */}
                {profiles.some((p) => (p.supplements ?? []).some((s) => s.meal === mealType)) && (
                  <View style={styles.supplementRow}>
                    {profiles
                      .flatMap((p) => (p.supplements ?? []).filter((s) => s.meal === mealType).map((s) => ({ ...s, memberName: p.name })))
                      .map((s) => (
                        <View key={`${s.id}-${s.memberName}`} style={styles.supplementChip}>
                          <Text style={styles.supplementText}>💊 {s.memberName}: {s.name} {s.dose}</Text>
                        </View>
                      ))}
                  </View>
                )}
              </View>
            ))}

            {!selectedPlan && !isGenerating && (
              <EmptyState
                emoji={tr.empty.mealPlan.emoji}
                title={tr.empty.mealPlan.title}
                description={tr.empty.mealPlan.desc}
                actionLabel={tr.empty.mealPlan.action}
                onAction={handleGeneratePlan}
              />
            )}
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── Alternative picker bottom sheet ─── */}
      <Modal
        visible={altSheet.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setAltSheet((p) => ({ ...p, visible: false }))}
      >
        <KeyboardAvoidingView
          style={styles.sheetOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setAltSheet((p) => ({ ...p, visible: false }))}
          />
          <View style={styles.sheet}>
            {/* Handle */}
            <View style={styles.sheetHandle} />

            <Text style={styles.sheetTitle}>
              {tr.nutrition.altTitle(MEAL_LABELS[altSheet.mealType].toLowerCase())}
            </Text>
            <Text style={styles.sheetSubtitle}>{tr.nutrition.altSubtitle}</Text>

            {altSheet.loading ? (
              <ActivityIndicator color={Colors.healthGreen} style={{ marginVertical: Spacing.xl }} />
            ) : altSheet.recipes.length === 0 ? (
              <Text style={styles.sheetEmpty}>{tr.nutrition.noAlternatives}</Text>
            ) : (
              <FlatList
                data={altSheet.recipes}
                keyExtractor={(r) => r.id}
                scrollEnabled={false}
                ItemSeparatorComponent={() => <View style={styles.sheetDivider} />}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.altRow}
                    onPress={() => handlePickAlternative(item)}
                    activeOpacity={0.7}
                  >
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.altThumb} />
                    ) : (
                      <View style={[styles.altThumb, styles.altThumbPlaceholder]}>
                        <Text style={{ fontSize: 20 }}>🍽️</Text>
                      </View>
                    )}
                    <View style={styles.altInfo}>
                      <Text style={styles.altName} numberOfLines={2}>{item.name}</Text>
                      <Text style={styles.altMeta}>
                        ⏱ {item.prepTime + item.cookTime} min · 🔥 {item.nutritionalInfo.calories} kcal
                      </Text>
                    </View>
                    <Text style={styles.altChevron}>›</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

function UploadProgressBar({ phase }: { phase: 'analyzing' | 'generating' }) {
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(anim, {
      toValue: phase === 'analyzing' ? 0.45 : 0.85,
      duration: 600,
      useNativeDriver: false,
    }).start()
  }, [phase])
  return (
    <View style={progressTrackStyle}>
      <Animated.View
        style={[progressFillStyle, { width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
      />
    </View>
  )
}

const progressTrackStyle = { height: 3, borderRadius: 2, backgroundColor: Colors.softMint, marginTop: 8, overflow: 'hidden' as const }
const progressFillStyle = { height: 3, borderRadius: 2, backgroundColor: Colors.healthGreen }

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.xs,
    },
    title: { ...Typography.displaySerif, color: colors.text },
    generateBtn: {
      backgroundColor: Colors.healthGreen, paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm, borderRadius: BorderRadius.pill, minWidth: 100, alignItems: 'center',
    },
    generateBtnDisabled: { backgroundColor: colors.textMuted },
    generateBtnText: { ...Typography.body, color: Colors.white, fontFamily: Typography.heading3.fontFamily },
    pillSelectorContent: { paddingVertical: Spacing.lg },
    scroll: { paddingHorizontal: Spacing.md, paddingTop: Spacing.lg },
    loader: { marginTop: Spacing.xxl },
    schoolBanner: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1, borderColor: colors.border,
      paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
      marginBottom: Spacing.md,
    },
    schoolBannerEmoji: { fontSize: 18 },
    schoolBannerText: { flex: 1 },
    schoolBannerTitle: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily },
    schoolBannerSub: { ...Typography.caption, color: colors.textSecondary, marginTop: 1 },
    schoolBannerArrow: { color: colors.textMuted, fontSize: 16 },
    uploadProgressContainer: { flex: 1 },
    uploadProgressHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.sm },
    uploadStatusText: { ...Typography.body, color: colors.text },
    mealsContainer: { gap: Spacing.md },
    supplementRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs, paddingHorizontal: Spacing.xs },
    supplementChip: { backgroundColor: `${Colors.goldenAmber}20`, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.pill },
    supplementText: { ...Typography.caption, color: colors.text },

    // Alternative picker sheet
    sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      paddingHorizontal: Spacing.md, paddingBottom: Spacing.xl, paddingTop: Spacing.sm,
    },
    sheetHandle: {
      alignSelf: 'center', width: 36, height: 4,
      borderRadius: 2, backgroundColor: colors.border, marginBottom: Spacing.md,
    },
    sheetTitle: { ...Typography.heading2, color: colors.text, marginBottom: 4 },
    sheetSubtitle: { ...Typography.caption, color: colors.textSecondary, marginBottom: Spacing.md },
    sheetEmpty: { ...Typography.body, color: colors.textMuted, textAlign: 'center', marginVertical: Spacing.xl },
    sheetDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
    altRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    altThumb: { width: 60, height: 60, borderRadius: BorderRadius.md, resizeMode: 'cover' },
    altThumbPlaceholder: { backgroundColor: colors.warmSurface, alignItems: 'center', justifyContent: 'center' },
    altInfo: { flex: 1 },
    altName: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily, lineHeight: 20 },
    altMeta: { ...Typography.caption, color: colors.textSecondary, marginTop: 3 },
    altChevron: { fontSize: 24, color: colors.textMuted, lineHeight: 28 },
  })
}
