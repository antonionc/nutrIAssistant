import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Alert,
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
import { useInventory } from '../../src/modules/inventory/useInventory'
import { useProfiles } from '../../src/modules/profiles/ProfilesContext'
import { Colors, Typography, Spacing, BorderRadius } from '../../src/theme'
import { useTheme, ThemeColors } from '../../src/theme/ThemeContext'
import { MealCard } from '../../src/components/cards/MealCard'
import { PillSelector, PillOption } from '../../src/components/inputs/PillSelector'
import { EmptyState } from '../../src/components/layout/EmptyState'
import { MealType } from '../../src/types/planner'

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
  } = usePlanner()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const dayOptions = getDayOptions()
  const todayStr = new Date().toISOString().split('T')[0]
  const [selectedDay, setSelectedDay] = useState(todayStr)
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'analyzing' | 'generating'>('idle')

  const selectedPlan = weekPlans.find((p) => p.date === selectedDay)

  const handleGeneratePlan = useCallback(async () => {
    await generateWeekPlan(inventory)
  }, [generateWeekPlan, inventory])

  const handleUploadSchoolMenu = useCallback(async () => {
    const schoolAgeMembers = profiles.filter((p) => p.isSchoolAge)
    if (schoolAgeMembers.length === 0) {
      Alert.alert('Sin miembros en edad escolar', 'Activa la opción de edad escolar para un miembro en Ajustes primero.')
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
      Alert.alert('¡Menú escolar subido!', 'La IA ha extraído el menú y ha regenerado tu plan de comidas.')
    } catch (error) {
      Alert.alert('Error al subir', error instanceof Error ? error.message : 'Error desconocido')
    } finally {
      setUploadPhase('idle')
    }
  }, [profiles, uploadSchoolMenu, handleGeneratePlan])

  const hasSchoolAgeMembers = profiles.some((p) => p.isSchoolAge)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Plan Nutricional</Text>
        <TouchableOpacity
          style={[styles.generateBtn, isGenerating && styles.generateBtnDisabled]}
          onPress={handleGeneratePlan}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <ActivityIndicator color={Colors.white} size="small" />
          ) : (
            <Text style={styles.generateBtnText}>✨ Generar</Text>
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
                <ActivityIndicator color={Colors.white} size="small" />
                <Text style={styles.uploadStatusText}>
                  {uploadPhase === 'analyzing' ? 'Analizando menú escolar...' : 'Generando plan de comidas...'}
                </Text>
              </View>
              <UploadProgressBar phase={uploadPhase} />
            </View>
          ) : (
            <>
              <Text style={styles.schoolBannerEmoji}>🏫</Text>
              <View style={styles.schoolBannerText}>
                <Text style={styles.schoolBannerTitle}>Subir menú escolar (PDF)</Text>
                <Text style={styles.schoolBannerSub}>
                  {hasSchoolAgeMembers
                    ? 'La IA extraerá e integrará el menú mensual del colegio'
                    : 'Activa edad escolar en un perfil para usar esta función'}
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
                  onSuggestAlternative={() => {}}
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
                emoji="🗓️"
                title="Sin plan para este día"
                description="Pulsa Generar para crear un plan de 7 días basado en tu despensa y perfiles familiares."
                actionLabel="Generar ahora"
                onAction={handleGeneratePlan}
              />
            )}
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>
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

const progressTrackStyle = { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', marginTop: 8, overflow: 'hidden' as const }
const progressFillStyle = { height: 3, borderRadius: 2, backgroundColor: Colors.white }

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
    },
    title: { ...Typography.heading1, color: colors.text },
    generateBtn: {
      backgroundColor: Colors.healthGreen, paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm, borderRadius: BorderRadius.pill, minWidth: 100, alignItems: 'center',
    },
    generateBtnDisabled: { backgroundColor: colors.textMuted },
    generateBtnText: { ...Typography.body, color: Colors.white, fontFamily: Typography.heading3.fontFamily },
    pillSelectorContent: { paddingVertical: Spacing.lg },
    scroll: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
    loader: { marginTop: Spacing.xxl },
    schoolBanner: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      backgroundColor: Colors.forestGreen, borderRadius: BorderRadius.lg,
      padding: Spacing.md, marginBottom: Spacing.md,
    },
    schoolBannerEmoji: { fontSize: 24 },
    schoolBannerText: { flex: 1 },
    schoolBannerTitle: { ...Typography.bodyLarge, color: Colors.white, fontFamily: Typography.heading3.fontFamily },
    schoolBannerSub: { ...Typography.caption, color: `${Colors.white}CC` },
    schoolBannerArrow: { color: Colors.white, fontSize: 20 },
    uploadProgressContainer: { flex: 1 },
    uploadProgressHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.sm },
    uploadStatusText: { ...Typography.body, color: Colors.white },
    mealsContainer: { gap: Spacing.md },
    supplementRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs, paddingHorizontal: Spacing.xs },
    supplementChip: { backgroundColor: `${Colors.goldenAmber}20`, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.pill },
    supplementText: { ...Typography.caption, color: colors.text },
  })
}
