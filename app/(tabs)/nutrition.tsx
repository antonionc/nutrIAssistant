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
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import { router } from 'expo-router'
import { usePlanner, SchoolMenuUploadError } from '../../src/modules/planner/PlannerContext'
import type { MenuMonthAnchor } from '../../src/services/schoolMenuParser'
import type { SchoolMenuEntry } from '../../src/types/profiles'
import { useInventory } from '../../src/modules/inventory/InventoryContext'
import { useProfiles } from '../../src/modules/profiles/ProfilesContext'
import { useSelectedProfile } from '../../src/modules/profiles/SelectedProfileContext'
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
import { HeaderProfileAvatar } from '../../src/components/layout/HeaderProfileAvatar'
import { logger } from '../../src/utils/logger'

function getDayOptions(): PillOption[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    // Pass undefined → toLocaleDateString uses the device locale.
    const day = d.toLocaleDateString(undefined, { weekday: 'short' })
    const date = d.toLocaleDateString(undefined, { day: 'numeric' })
    const id = d.toISOString().split('T')[0]
    return { id, label: day, sublabel: date }
  })
}

export default function NutritionScreen() {
  const { profiles } = useProfiles()
  const { selectedId } = useSelectedProfile()
  // Members ordered with the active profile first so MealCard's compatibility
  // row emphasises them; the rest of the family is still represented.
  const orderedMembers = useMemo(() => {
    if (!selectedId) return profiles
    const sel = profiles.find((p) => p.id === selectedId)
    if (!sel) return profiles
    return [sel, ...profiles.filter((p) => p.id !== selectedId)]
  }, [profiles, selectedId])
  const { items: inventory } = useInventory()
  const {
    weekPlans,
    isLoading,
    isGenerating,
    generateWeekPlan,
    lockDay,
    parseSchoolMenuForReview,
    commitSchoolMenuEntries,
    setMealForDate,
    schoolMenuChildIds,
    getSchoolMenuEntries,
    getMembersAtSchoolOn,
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

  // Child-target picker (shown before file picker when 2+ school-age members).
  // The promise resolver lets handleUploadSchoolMenu await the user's choice
  // and keeps the upload flow linear without lifting more state into refs.
  const [childPicker, setChildPicker] = useState<{
    visible: boolean
    selected: Set<string>
  }>({ visible: false, selected: new Set() })
  const childPickerResolverRef = useRef<((ids: string[] | null) => void) | null>(null)

  // View-school-menu sheet
  type SchoolEntry = {
    id: string
    date: string
    childId: string
    description: string
    firstCourse?: string
    secondCourse?: string
    dessert?: string
    extractedIngredients: string[]
    extractedAllergens: string[]
    nutritionalEstimate?: { calories: number; protein: number; carbs: number; fat: number }
  }
  const [menuSheet, setMenuSheet] = useState<{
    visible: boolean
    activeChildId: string | null
    entries: SchoolEntry[]
    loading: boolean
  }>({ visible: false, activeChildId: null, entries: [], loading: false })

  // Review modal — opens after the PDF is parsed but BEFORE entries are
  // persisted. The user can edit each course or remove rows; tapping
  // Save commits to the DB and kicks off plan generation. Tapping Cancel
  // discards the drafts entirely (no DB writes have happened yet).
  type ReviewDraft = Omit<SchoolMenuEntry, 'id' | 'childId'>
  const [reviewSheet, setReviewSheet] = useState<{
    visible: boolean
    entries: ReviewDraft[]
    childIds: string[]
    anchor: MenuMonthAnchor | null
    saving: boolean
  }>({ visible: false, entries: [], childIds: [], anchor: null, saving: false })

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

  const openChildTargetPicker = useCallback(
    (candidateIds: string[]): Promise<string[] | null> => {
      return new Promise((resolve) => {
        childPickerResolverRef.current = resolve
        setChildPicker({ visible: true, selected: new Set(candidateIds) })
      })
    },
    []
  )

  const closeChildPicker = useCallback((result: string[] | null) => {
    setChildPicker((prev) => ({ ...prev, visible: false }))
    const resolver = childPickerResolverRef.current
    childPickerResolverRef.current = null
    resolver?.(result)
  }, [])

  const toggleChildInPicker = useCallback((id: string) => {
    setChildPicker((prev) => {
      const next = new Set(prev.selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...prev, selected: next }
    })
  }, [])

  const handleUploadSchoolMenu = useCallback(async () => {
    const schoolAgeMembers = profiles.filter((p) => p.isSchoolAge)
    if (schoolAgeMembers.length === 0) {
      Alert.alert(tr.nutrition.noSchoolAgeMembers, tr.nutrition.noSchoolAgeMembersDesc)
      return
    }

    let targetChildIds: string[]
    if (schoolAgeMembers.length === 1) {
      targetChildIds = [schoolAgeMembers[0].id]
    } else {
      const picked = await openChildTargetPicker(schoolAgeMembers.map((m) => m.id))
      if (!picked || picked.length === 0) return
      targetChildIds = picked
    }

    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    })

    if (result.canceled || !result.assets?.[0]) return

    const file = result.assets[0]
    setUploadPhase('analyzing')
    try {
      const parsed = await parseSchoolMenuForReview(file.uri)
      // Open the review modal. NOTHING has been written to the DB yet —
      // commit happens inside the modal's Save handler. We deliberately do
      // not call handleGeneratePlan here; that runs after Save so the plan
      // reflects whatever the user committed.
      setReviewSheet({
        visible: true,
        entries: parsed.entries,
        childIds: targetChildIds,
        anchor: parsed.anchor,
        saving: false,
      })
    } catch (error) {
      logger.error('[Nutrition] School menu parse failed:', error)
      const message =
        error instanceof SchoolMenuUploadError
          ? tr.nutrition[
              ({
                llm_not_ready: 'errLlmNotReady',
                pdf_empty: 'errPdfEmpty',
                pdf_extract: 'errPdfExtract',
                llm_parse: 'errLlmParse',
                llm_generate: 'errLlmGenerate',
              } as const)[error.stage]
            ]
          : error instanceof Error
          ? error.message
          : tr.app.error
      Alert.alert(tr.nutrition.uploadFailed, message)
    } finally {
      setUploadPhase('idle')
    }
  }, [profiles, parseSchoolMenuForReview, openChildTargetPicker, tr])

  // Helpers for the review modal: edit, remove, add days. Each edit returns
  // a fresh entries array so React re-renders the affected row immediately.
  const updateReviewEntry = useCallback(
    (index: number, patch: Partial<ReviewDraft>) => {
      setReviewSheet((prev) => ({
        ...prev,
        entries: prev.entries.map((e, i) => (i === index ? { ...e, ...patch } : e)),
      }))
    },
    []
  )

  const removeReviewEntry = useCallback((index: number) => {
    setReviewSheet((prev) => ({
      ...prev,
      entries: prev.entries.filter((_, i) => i !== index),
    }))
  }, [])

  const addReviewEntry = useCallback(() => {
    setReviewSheet((prev) => {
      // Pick the day after the last existing entry; if there are none, use
      // the anchor's first weekday of the month so the new row sits where
      // the user expects.
      let nextDate: string
      if (prev.entries.length > 0) {
        const last = prev.entries[prev.entries.length - 1].date
        const d = new Date(last)
        d.setDate(d.getDate() + 1)
        nextDate = d.toISOString().split('T')[0]
      } else if (prev.anchor) {
        const d = new Date(prev.anchor.year, prev.anchor.month - 1, 1)
        nextDate = d.toISOString().split('T')[0]
      } else {
        nextDate = new Date().toISOString().split('T')[0]
      }
      const draft: ReviewDraft = {
        date: nextDate,
        meal: 'lunch',
        description: '',
        firstCourse: undefined,
        secondCourse: undefined,
        dessert: undefined,
        extractedIngredients: [],
        extractedAllergens: [],
      }
      return { ...prev, entries: [...prev.entries, draft] }
    })
  }, [])

  const cancelReview = useCallback(() => {
    setReviewSheet({
      visible: false,
      entries: [],
      childIds: [],
      anchor: null,
      saving: false,
    })
  }, [])

  const saveReview = useCallback(async () => {
    setReviewSheet((prev) => ({ ...prev, saving: true }))
    try {
      const { entries, childIds } = reviewSheet
      const summary = await commitSchoolMenuEntries(entries, childIds)
      setUploadPhase('generating')
      await handleGeneratePlan()
      const fmt = (iso: string) => {
        const d = new Date(iso)
        return Number.isNaN(d.getTime())
          ? iso
          : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      }
      const detail = summary.firstDate && summary.lastDate
        ? tr.nutrition.schoolMenuUploadSummary(
            summary.entryCount,
            fmt(summary.firstDate),
            fmt(summary.lastDate),
          )
        : tr.nutrition.uploadSuccessDesc
      setReviewSheet({
        visible: false,
        entries: [],
        childIds: [],
        anchor: null,
        saving: false,
      })
      Alert.alert(tr.nutrition.uploadSuccess, detail)
    } catch (error) {
      logger.error('[Nutrition] School menu commit failed:', error)
      const message = error instanceof Error ? error.message : tr.app.error
      Alert.alert(tr.nutrition.uploadFailed, message)
      setReviewSheet((prev) => ({ ...prev, saving: false }))
    } finally {
      setUploadPhase('idle')
    }
  }, [reviewSheet, commitSchoolMenuEntries, handleGeneratePlan, tr])

  const hasSchoolAgeMembers = profiles.some((p) => p.isSchoolAge)

  // ── View school menu sheet: lazy-load entries when sheet opens or active
  // child changes. The button that triggers this is only rendered when
  // schoolMenuChildIds is non-empty, so we always have at least one candidate.
  const openMenuSheet = useCallback(() => {
    const firstChild = schoolMenuChildIds[0] ?? null
    setMenuSheet({ visible: true, activeChildId: firstChild, entries: [], loading: true })
  }, [schoolMenuChildIds])

  useEffect(() => {
    if (!menuSheet.visible || !menuSheet.activeChildId) return
    let cancelled = false
    setMenuSheet((prev) => ({ ...prev, loading: true }))
    getSchoolMenuEntries(menuSheet.activeChildId)
      .then((entries) => {
        if (cancelled) return
        setMenuSheet((prev) => ({ ...prev, entries, loading: false }))
      })
      .catch(() => {
        if (cancelled) return
        setMenuSheet((prev) => ({ ...prev, entries: [], loading: false }))
      })
    return () => {
      cancelled = true
    }
  }, [menuSheet.visible, menuSheet.activeChildId, getSchoolMenuEntries])

  const formatMenuDate = useCallback((iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    })
  }, [])

  // The sheet shows today + the next 4 calendar days, in chronological
  // order. Days without an entry render as "Sin datos" so the layout
  // stays predictable. When no entry falls inside the window we DON'T
  // surface older orphaned uploads (would mislead the user); instead the
  // sheet shows an explicit empty-state banner with an "upload this
  // month's menu" CTA, handled in the render path below.
  const fiveDayWindow = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const byDate = new Map(menuSheet.entries.map((e) => [e.date, e]))
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      const iso = d.toISOString().split('T')[0]
      return { iso, isToday: i === 0, entry: byDate.get(iso) ?? null }
    })
  }, [menuSheet.entries])

  const windowIsEmpty = useMemo(
    () => fiveDayWindow.every((d) => d.entry === null),
    [fiveDayWindow]
  )

  // Triggered by the empty-window CTA: close the menu sheet first so the
  // upload's child-picker / document-picker / review modals are visible.
  const openUploadFromEmptyWindow = useCallback(() => {
    setMenuSheet((prev) => ({ ...prev, visible: false }))
    // Defer so the sheet's exit animation can finish before the upload
    // flow opens its own modal — looks abrupt otherwise.
    setTimeout(() => {
      handleUploadSchoolMenu()
    }, 200)
  }, [handleUploadSchoolMenu])

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header — title + avatar only. Action buttons live below the day
          selector so the title row has room to breathe and the two main
          actions get equal visual weight side-by-side. */}
      <View style={styles.header}>
        <Text style={styles.title}>{tr.nutrition.title}</Text>
        <HeaderProfileAvatar />
      </View>

      {/* Day Selector */}
      <PillSelector
        options={dayOptions}
        selectedId={selectedDay}
        onSelect={setSelectedDay}
        style={styles.pillSelectorContent}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Action tiles row — school menu upload + AI plan generation. Equal
            width so neither dominates; both share the same compact tile shape
            with emoji + title + subtitle. */}
        <View style={styles.actionTilesRow}>
          <TouchableOpacity
            style={[styles.actionTile, styles.actionTileWide]}
            onPress={handleUploadSchoolMenu}
            disabled={uploadPhase !== 'idle'}
            activeOpacity={0.85}
          >
            {uploadPhase !== 'idle' ? (
              <View style={styles.uploadProgressContainer}>
                <View style={styles.uploadProgressHeader}>
                  <ActivityIndicator color={Colors.healthGreen} size="small" />
                  <Text style={styles.uploadStatusText} numberOfLines={2}>
                    {uploadPhase === 'analyzing' ? tr.nutrition.analyzingMenu : tr.nutrition.generatingPlan}
                  </Text>
                </View>
                <UploadProgressBar phase={uploadPhase} />
              </View>
            ) : (
              <>
                <Text style={styles.actionTileEmoji}>🏫</Text>
                <Text style={styles.actionTileTitle} numberOfLines={2}>
                  {tr.nutrition.uploadSchoolMenu}
                </Text>
                <Text style={styles.actionTileSub} numberOfLines={2}>
                  {hasSchoolAgeMembers
                    ? tr.nutrition.uploadSchoolMenuSub
                    : tr.nutrition.noSchoolEnabledNote}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionTile, isGenerating && styles.actionTileDisabled]}
            onPress={handleGeneratePlan}
            disabled={isGenerating}
            activeOpacity={0.85}
          >
            {isGenerating ? (
              <View style={styles.uploadProgressContainer}>
                <View style={styles.uploadProgressHeader}>
                  <ActivityIndicator color={Colors.healthGreen} size="small" />
                  <Text style={styles.uploadStatusText} numberOfLines={2}>
                    {tr.nutrition.generatingPlan}
                  </Text>
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.actionTileEmoji}>✨</Text>
                <Text style={styles.actionTileTitle} numberOfLines={2}>
                  {tr.nutrition.generateTileTitle}
                </Text>
                <Text style={styles.actionTileSub} numberOfLines={2}>
                  {tr.nutrition.generateTileSubtitle}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* View planned school menu — only when at least one child has an
            uploaded menu in the DB. Compact pill below the action tiles. */}
        {schoolMenuChildIds.length > 0 && (
          <TouchableOpacity
            style={styles.viewMenuPill}
            onPress={openMenuSheet}
            activeOpacity={0.85}
          >
            <Text style={styles.viewMenuPillText}>🏫 {tr.nutrition.viewSchoolMenu}</Text>
          </TouchableOpacity>
        )}

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
                  members={orderedMembers}
                  activeMemberId={selectedId ?? undefined}
                  isLocked={selectedPlan?.isLocked}
                  isGenerating={isGenerating}
                  onPress={() => {
                    const recipe = selectedPlan?.meals[mealType]
                    if (recipe) router.push(`/recipe/${recipe.id}`)
                  }}
                  onLock={() => lockDay(selectedDay)}
                  onSuggestAlternative={() => handleSuggestAlternative(mealType)}
                />

                {/* "Eats at school" chips — only on the lunch slot, only for
                    minors whose school menu covers the selected day. The
                    generated lunch recipe is for the rest of the family. */}
                {mealType === 'lunch' && (() => {
                  const eatingAtSchool = getMembersAtSchoolOn(selectedDay)
                    .map((id) => profiles.find((p) => p.id === id))
                    .filter((p): p is NonNullable<typeof p> => p !== undefined)
                  if (eatingAtSchool.length === 0) return null
                  return (
                    <View style={styles.supplementRow}>
                      {eatingAtSchool.map((p) => (
                        <View key={`school-${p.id}`} style={styles.schoolMealChip}>
                          <Text style={styles.supplementText}>🏫 {p.name}: {tr.nutrition.eatsAtSchool}</Text>
                        </View>
                      ))}
                    </View>
                  )
                })()}

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

      {/* ── Child-target picker (shown before file picker when family has
          two or more school-age children, so the user can bind the PDF to
          the correct children) ─── */}
      <Modal
        visible={childPicker.visible}
        transparent
        animationType="slide"
        onRequestClose={() => closeChildPicker(null)}
      >
        <KeyboardAvoidingView
          style={styles.sheetOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => closeChildPicker(null)}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{tr.nutrition.pickChildrenTitle}</Text>
            <Text style={styles.sheetSubtitle}>{tr.nutrition.pickChildrenSubtitle}</Text>

            {profiles
              .filter((p) => p.isSchoolAge)
              .map((member) => {
                const checked = childPicker.selected.has(member.id)
                const age = (() => {
                  const d = new Date(member.dateOfBirth)
                  if (Number.isNaN(d.getTime())) return null
                  const ageMs = Date.now() - d.getTime()
                  return Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000))
                })()
                return (
                  <TouchableOpacity
                    key={member.id}
                    style={styles.childRow}
                    onPress={() => toggleChildInPicker(member.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                      {checked && <Text style={styles.checkboxMark}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.childName}>{member.name}</Text>
                      {age !== null && (
                        <Text style={styles.childMeta}>
                          {tr.onboarding.summaryAge(age)}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                )
              })}

            <View style={styles.childPickerFooter}>
              <TouchableOpacity
                style={styles.childPickerCancel}
                onPress={() => closeChildPicker(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.childPickerCancelText}>{tr.app.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.childPickerContinue,
                  childPicker.selected.size === 0 && styles.childPickerContinueDisabled,
                ]}
                onPress={() => closeChildPicker(Array.from(childPicker.selected))}
                disabled={childPicker.selected.size === 0}
                activeOpacity={0.85}
              >
                <Text style={styles.childPickerContinueText}>
                  {tr.nutrition.pickChildrenContinue}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── View planned school menu sheet ─── */}
      <Modal
        visible={menuSheet.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuSheet((p) => ({ ...p, visible: false }))}
      >
        <KeyboardAvoidingView
          style={styles.sheetOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setMenuSheet((p) => ({ ...p, visible: false }))}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{tr.nutrition.schoolMenuSheetTitle}</Text>
            <Text style={styles.sheetSubtitle}>{tr.nutrition.schoolMenuSheetSubtitle}</Text>

            {/* Child selector — only when more than one child has a menu */}
            {schoolMenuChildIds.length > 1 && (
              <View style={styles.menuChildPills}>
                {schoolMenuChildIds.map((id) => {
                  const member = profiles.find((p) => p.id === id)
                  const isActive = id === menuSheet.activeChildId
                  return (
                    <TouchableOpacity
                      key={id}
                      style={[styles.menuChildPill, isActive && styles.menuChildPillActive]}
                      onPress={() => setMenuSheet((prev) => ({ ...prev, activeChildId: id }))}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.menuChildPillText,
                          isActive && styles.menuChildPillTextActive,
                        ]}
                      >
                        {member?.name ?? id}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            )}

            {menuSheet.loading ? (
              <ActivityIndicator color={Colors.healthGreen} style={{ marginVertical: Spacing.xl }} />
            ) : (
              <>
                {windowIsEmpty && (
                  <View style={styles.menuEmptyBanner}>
                    <Text style={styles.menuEmptyTitle}>
                      {tr.nutrition.schoolMenuEmptyWindowTitle}
                    </Text>
                    <Text style={styles.menuEmptyMessage}>
                      {tr.nutrition.schoolMenuEmptyWindowMessage}
                    </Text>
                    <TouchableOpacity
                      style={styles.menuEmptyCta}
                      onPress={openUploadFromEmptyWindow}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.menuEmptyCtaText}>
                        {tr.nutrition.schoolMenuEmptyWindowCta}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
                <FlatList
                  data={fiveDayWindow}
                  keyExtractor={(d) => d.iso}
                  ItemSeparatorComponent={() => <View style={styles.sheetDivider} />}
                  style={{ maxHeight: 480 }}
                  renderItem={({ item }) => (
                    <SchoolMenuDayRow
                      day={item}
                      formatDate={formatMenuDate}
                      styles={styles}
                      tr={tr}
                    />
                  )}
                />
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Review parsed school-menu entries (post-parse, pre-commit) ─── */}
      <Modal
        visible={reviewSheet.visible}
        transparent
        animationType="slide"
        onRequestClose={cancelReview}
      >
        <KeyboardAvoidingView
          style={styles.sheetOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={cancelReview}
            disabled={reviewSheet.saving}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{tr.nutrition.schoolMenuReviewTitle}</Text>
            <Text style={styles.sheetSubtitle}>{tr.nutrition.schoolMenuReviewSubtitle}</Text>

            <FlatList
              data={reviewSheet.entries}
              keyExtractor={(_, i) => `review-${i}`}
              ItemSeparatorComponent={() => <View style={styles.sheetDivider} />}
              style={{ maxHeight: 460 }}
              ListEmptyComponent={
                <Text style={styles.menuNoData}>{tr.nutrition.schoolMenuReviewEmpty}</Text>
              }
              renderItem={({ item, index }) => (
                <SchoolMenuReviewRow
                  draft={item}
                  index={index}
                  onChange={updateReviewEntry}
                  onRemove={removeReviewEntry}
                  styles={styles}
                  tr={tr}
                  formatDate={formatMenuDate}
                  disabled={reviewSheet.saving}
                />
              )}
            />

            <TouchableOpacity
              style={styles.menuReviewAddRow}
              onPress={addReviewEntry}
              disabled={reviewSheet.saving}
              activeOpacity={0.85}
            >
              <Text style={styles.menuReviewAddText}>＋ {tr.nutrition.schoolMenuReviewAddDay}</Text>
            </TouchableOpacity>

            <View style={styles.menuReviewActions}>
              <TouchableOpacity
                style={[styles.menuReviewBtn, styles.menuReviewBtnSecondary]}
                onPress={cancelReview}
                disabled={reviewSheet.saving}
                activeOpacity={0.85}
              >
                <Text style={styles.menuReviewBtnSecondaryText}>
                  {tr.nutrition.schoolMenuReviewCancel}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.menuReviewBtn,
                  styles.menuReviewBtnPrimary,
                  (reviewSheet.saving || reviewSheet.entries.length === 0) && styles.menuReviewBtnDisabled,
                ]}
                onPress={saveReview}
                disabled={reviewSheet.saving || reviewSheet.entries.length === 0}
                activeOpacity={0.85}
              >
                {reviewSheet.saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.menuReviewBtnPrimaryText}>
                    {tr.nutrition.schoolMenuReviewSave}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

// One row in the review modal: weekday header + three TextInputs + remove
// button. Editing flows back to the parent through `onChange(index, patch)`.
function SchoolMenuReviewRow({
  draft,
  index,
  onChange,
  onRemove,
  styles,
  tr,
  formatDate,
  disabled,
}: {
  draft: Omit<SchoolMenuEntry, 'id' | 'childId'>
  index: number
  onChange: (index: number, patch: Partial<Omit<SchoolMenuEntry, 'id' | 'childId'>>) => void
  onRemove: (index: number) => void
  styles: ReturnType<typeof makeStyles>
  tr: ReturnType<typeof useTranslation>
  formatDate: (iso: string) => string
  disabled: boolean
}) {
  return (
    <View style={styles.menuReviewRow}>
      <View style={styles.menuReviewRowHeader}>
        <Text style={styles.menuDayDate}>{formatDate(draft.date)}</Text>
        <TouchableOpacity
          onPress={() => onRemove(index)}
          disabled={disabled}
          activeOpacity={0.7}
        >
          <Text style={styles.menuReviewRemove}>{tr.nutrition.schoolMenuReviewRemoveDay}</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.menuReviewInput}
        value={draft.firstCourse ?? ''}
        onChangeText={(v) => onChange(index, { firstCourse: v.trim() ? v : undefined })}
        placeholder={tr.nutrition.schoolMenuReviewFirstCoursePlaceholder}
        placeholderTextColor={styles.menuReviewInputPlaceholder.color}
        editable={!disabled}
      />
      <TextInput
        style={styles.menuReviewInput}
        value={draft.secondCourse ?? ''}
        onChangeText={(v) => onChange(index, { secondCourse: v.trim() ? v : undefined })}
        placeholder={tr.nutrition.schoolMenuReviewSecondCoursePlaceholder}
        placeholderTextColor={styles.menuReviewInputPlaceholder.color}
        editable={!disabled}
      />
      <TextInput
        style={styles.menuReviewInput}
        value={draft.dessert ?? ''}
        onChangeText={(v) => onChange(index, { dessert: v.trim() ? v : undefined })}
        placeholder={tr.nutrition.schoolMenuReviewDessertPlaceholder}
        placeholderTextColor={styles.menuReviewInputPlaceholder.color}
        editable={!disabled}
      />
    </View>
  )
}

// A single day in the "today + next 4 days" school-menu sheet. Renders the
// weekday header (today flagged), three labelled course rows, and an
// allergen chip strip. Courses the parser could not isolate render as
// "Sin datos" to keep the row's vertical rhythm constant.
function SchoolMenuDayRow({
  day,
  formatDate,
  styles,
  tr,
}: {
  day: {
    iso: string
    isToday: boolean
    entry: {
      description: string
      firstCourse?: string
      secondCourse?: string
      dessert?: string
      extractedAllergens: string[]
    } | null
  }
  formatDate: (iso: string) => string
  styles: ReturnType<typeof makeStyles>
  tr: ReturnType<typeof useTranslation>
}) {
  const { entry } = day
  // When the structured fields are all missing but a description exists,
  // surface the raw description on the first-course row so legacy rows
  // (parsed before migration 017) still show something readable.
  const fallback = entry && !entry.firstCourse && !entry.secondCourse && !entry.dessert
    ? entry.description.trim()
    : null
  const noData = !entry || (
    !entry.firstCourse && !entry.secondCourse && !entry.dessert && !fallback
  )

  return (
    <View style={styles.menuDayRow}>
      <View style={styles.menuDayHeader}>
        <Text style={styles.menuDayDate}>{formatDate(day.iso)}</Text>
        {day.isToday && (
          <View style={styles.menuTodayChip}>
            <Text style={styles.menuTodayChipText}>{tr.nutrition.schoolMenuToday}</Text>
          </View>
        )}
      </View>

      {noData ? (
        <Text style={styles.menuNoData}>{tr.nutrition.schoolMenuNoData}</Text>
      ) : fallback ? (
        <Text style={styles.menuCourseText}>{fallback}</Text>
      ) : (
        <View style={styles.menuCourseList}>
          <CourseLine
            label={tr.nutrition.schoolMenuFirstCourse}
            value={entry!.firstCourse}
            styles={styles}
            tr={tr}
          />
          <CourseLine
            label={tr.nutrition.schoolMenuSecondCourse}
            value={entry!.secondCourse}
            styles={styles}
            tr={tr}
          />
          <CourseLine
            label={tr.nutrition.schoolMenuDessert}
            value={entry!.dessert}
            styles={styles}
            tr={tr}
          />
        </View>
      )}

      {entry && entry.extractedAllergens.length > 0 && (
        <View style={styles.menuAllergenWrap}>
          <Text style={styles.menuAllergenLabel}>
            {tr.nutrition.schoolMenuAllergensLabel}:
          </Text>
          {entry.extractedAllergens.map((a) => (
            <View key={a} style={styles.menuAllergenChip}>
              <Text style={styles.menuAllergenChipText}>{a}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function CourseLine({
  label,
  value,
  styles,
  tr,
}: {
  label: string
  value: string | undefined
  styles: ReturnType<typeof makeStyles>
  tr: ReturnType<typeof useTranslation>
}) {
  return (
    <View style={styles.menuCourseLine}>
      <Text style={styles.menuCourseLabel}>{label}</Text>
      <Text style={[styles.menuCourseText, !value && styles.menuCourseTextMuted]}>
        {value ?? tr.nutrition.schoolMenuNoData}
      </Text>
    </View>
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
    pillSelectorContent: { paddingVertical: Spacing.lg },
    scroll: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
    loader: { marginTop: Spacing.xxl },

    // Action tiles row (school menu upload + AI generation)
    actionTilesRow: {
      flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md,
    },
    actionTile: {
      flex: 1, minHeight: 96,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1, borderColor: colors.border,
      paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
      gap: 2, justifyContent: 'center',
    },
    // School-menu tile carries the longest title + subtitle ("Subir menú
    // escolar (PDF)" / "La IA extraerá e integrará…"), so it gets ~63% of
    // the row width and the generate tile gets the remaining ~37%.
    actionTileWide: { flex: 1.7 },
    actionTileDisabled: { opacity: 0.6 },
    actionTileEmoji: { fontSize: 20, marginBottom: Spacing.xs },
    actionTileTitle: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily },
    actionTileSub: { ...Typography.caption, color: colors.textSecondary, marginTop: 2 },

    uploadProgressContainer: { flex: 1, justifyContent: 'center' },
    uploadProgressHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.sm },
    uploadStatusText: { ...Typography.caption, color: colors.text, flex: 1 },
    mealsContainer: { gap: Spacing.md },
    supplementRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs, paddingHorizontal: Spacing.xs },
    supplementChip: { backgroundColor: `${Colors.goldenAmber}20`, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.pill },
    schoolMealChip: { backgroundColor: `${Colors.healthGreen}20`, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.pill },
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

    // "Ver menú escolar" pill — appears only when at least one child has an
    // uploaded school menu in the DB.
    viewMenuPill: {
      alignSelf: 'center',
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.pill,
      backgroundColor: Colors.softMint,
      marginBottom: Spacing.md,
    },
    viewMenuPillText: {
      ...Typography.body,
      color: Colors.forestGreen,
      fontFamily: Typography.heading3.fontFamily,
    },

    // Child-target picker rows + footer
    childRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    checkboxChecked: {
      backgroundColor: Colors.healthGreen,
      borderColor: Colors.healthGreen,
    },
    checkboxMark: {
      color: Colors.white,
      fontSize: 14,
      lineHeight: 16,
      fontWeight: '700',
    },
    childName: {
      ...Typography.body,
      color: colors.text,
      fontFamily: Typography.heading3.fontFamily,
    },
    childMeta: {
      ...Typography.caption,
      color: colors.textSecondary,
      marginTop: 2,
    },
    childPickerFooter: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginTop: Spacing.md,
    },
    childPickerCancel: {
      flex: 1,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.warmSurface,
      alignItems: 'center',
    },
    childPickerCancelText: {
      ...Typography.body,
      color: colors.text,
      fontFamily: Typography.heading3.fontFamily,
    },
    childPickerContinue: {
      flex: 1.4,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: Colors.healthGreen,
      alignItems: 'center',
    },
    childPickerContinueDisabled: {
      opacity: 0.5,
    },
    childPickerContinueText: {
      ...Typography.body,
      color: Colors.white,
      fontFamily: Typography.heading3.fontFamily,
    },

    // View-menu sheet: child pills + entry rows
    menuChildPills: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.sm,
      marginBottom: Spacing.md,
    },
    menuChildPill: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      borderRadius: BorderRadius.pill,
      backgroundColor: colors.warmSurface,
    },
    menuChildPillActive: {
      backgroundColor: Colors.healthGreen,
    },
    menuChildPillText: {
      ...Typography.caption,
      color: colors.text,
      fontFamily: Typography.heading3.fontFamily,
    },
    menuChildPillTextActive: {
      color: Colors.white,
    },
    // ── School-menu day rows (today + 4) ────────────────────────────────────
    menuDayRow: {
      paddingVertical: Spacing.md,
    },
    menuDayHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    menuDayDate: {
      ...Typography.body,
      color: Colors.forestGreen,
      fontFamily: Typography.heading3.fontFamily,
      textTransform: 'capitalize',
    },
    menuTodayChip: {
      backgroundColor: `${Colors.healthGreen}1f`,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.pill,
    },
    menuTodayChipText: {
      ...Typography.overline,
      color: Colors.forestGreen,
      fontSize: 10,
      letterSpacing: 0.4,
    },
    menuOrphanBanner: {
      backgroundColor: `${Colors.goldenAmber}20`,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
      marginTop: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    menuOrphanText: {
      ...Typography.caption,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    menuCourseList: {
      gap: Spacing.xs,
    },
    menuCourseLine: {
      gap: 1,
    },
    menuCourseLabel: {
      ...Typography.caption,
      color: colors.textSecondary,
      fontFamily: Typography.heading3.fontFamily,
      fontSize: 11,
      letterSpacing: 0.3,
      textTransform: 'uppercase',
    },
    menuCourseText: {
      ...Typography.body,
      color: colors.text,
      lineHeight: 20,
    },
    menuCourseTextMuted: {
      color: colors.textMuted,
      fontStyle: 'italic',
    },
    menuNoData: {
      ...Typography.body,
      color: colors.textMuted,
      fontStyle: 'italic',
      paddingVertical: Spacing.xs,
    },
    menuAllergenWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: Spacing.xs,
      marginTop: Spacing.xs,
    },
    menuAllergenLabel: {
      ...Typography.caption,
      color: colors.textSecondary,
    },
    menuAllergenChip: {
      backgroundColor: `${Colors.goldenAmber}20`,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.pill,
    },
    menuAllergenChipText: {
      ...Typography.caption,
      color: colors.text,
    },
    // ── Empty-window banner (sheet shows when no entry falls in today+4)
    menuEmptyBanner: {
      backgroundColor: `${Colors.healthGreen}12`,
      borderRadius: BorderRadius.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      marginTop: Spacing.sm,
      marginBottom: Spacing.sm,
      gap: Spacing.xs,
    },
    menuEmptyTitle: {
      ...Typography.heading3,
      color: colors.text,
    },
    menuEmptyMessage: {
      ...Typography.body,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    menuEmptyCta: {
      alignSelf: 'flex-start',
      backgroundColor: Colors.healthGreen,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.pill,
      marginTop: Spacing.xs,
    },
    menuEmptyCtaText: {
      ...Typography.body,
      color: '#fff',
      fontFamily: Typography.heading3.fontFamily,
    },
    // ── Review modal (edit parsed entries before commit) ────────────────
    menuReviewRow: {
      paddingVertical: Spacing.sm,
      gap: Spacing.xs,
    },
    menuReviewRowHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.xs,
    },
    menuReviewRemove: {
      ...Typography.caption,
      color: Colors.errorRed,
    },
    menuReviewInput: {
      ...Typography.body,
      color: colors.text,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    menuReviewInputPlaceholder: {
      color: colors.textMuted,
    },
    menuReviewAddRow: {
      paddingVertical: Spacing.sm,
      alignItems: 'center',
    },
    menuReviewAddText: {
      ...Typography.body,
      color: Colors.healthGreen,
      fontFamily: Typography.heading3.fontFamily,
    },
    menuReviewActions: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    menuReviewBtn: {
      flex: 1,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
    },
    menuReviewBtnPrimary: {
      backgroundColor: Colors.healthGreen,
    },
    menuReviewBtnSecondary: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    menuReviewBtnDisabled: {
      opacity: 0.5,
    },
    menuReviewBtnPrimaryText: {
      ...Typography.body,
      color: '#fff',
      fontFamily: Typography.heading3.fontFamily,
    },
    menuReviewBtnSecondaryText: {
      ...Typography.body,
      color: colors.text,
    },
  })
}
