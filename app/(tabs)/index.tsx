import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Dimensions,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useTranslation } from '../../src/i18n'
import { getAge } from '../../src/utils/ageUtils'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useProfiles } from '../../src/modules/profiles/ProfilesContext'
import { useInventory } from '../../src/modules/inventory/InventoryContext'
import { usePlanner } from '../../src/modules/planner/PlannerContext'
import { useRecipeDB } from '../../src/modules/recipes/useRecipeDB'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../src/theme'
import { useTheme, ThemeColors } from '../../src/theme/ThemeContext'
import { ProgressRing } from '../../src/components/charts/ProgressRing'
import { MealCard } from '../../src/components/cards/MealCard'
import { RecipeCard } from '../../src/components/cards/RecipeCard'
import { FamilyMember } from '../../src/types/profiles'
import { getMemberAvatarSource } from '../../src/services/avatarService'
import { Recipe } from '../../src/types/recipes'
import { AllergyPill } from '../../src/components/badges/AllergyPill'
import { HeaderProfileAvatar } from '../../src/components/layout/HeaderProfileAvatar'
import { useSelectedProfile } from '../../src/modules/profiles/SelectedProfileContext'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

const NEWS_ITEMS = [
  {
    id: '1',
    headline: 'La dieta mediterránea reduce el riesgo de demencia en un 25%, según nuevo estudio',
    source: 'Harvard Health',
    emoji: '🫒',
  },
  {
    id: '2',
    headline: 'Calcio y Vitamina D: por qué importan para la salud ósea en todas las edades',
    source: 'Mayo Clinic',
    emoji: '🦴',
  },
  {
    id: '3',
    headline: 'Cómo reducir el sodio en tu dieta sin sacrificar el sabor',
    source: 'American Heart Association',
    emoji: '🧂',
  },
]

export default function HomeScreen() {
  const tr = useTranslation()
  const { profiles, familyName } = useProfiles()
  const { selected, selectedId, select, isSuperUser } = useSelectedProfile()
  const { expiryAlerts, getLowStockAlerts } = useInventory()
  const { weekPlans } = usePlanner()
  const { getRandom } = useRecipeDB()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [featuredRecipes, setFeaturedRecipes] = useState<Recipe[]>([])
  const carouselRef = useRef<FlatList<FamilyMember>>(null)
  const activeMemberIndex = Math.max(0, profiles.findIndex((p) => p.id === selectedId))
  const [activeMealIndex, setActiveMealIndex] = useState(0)

  const todayStr = new Date().toISOString().split('T')[0]
  const todayPlan = weekPlans.find((p) => p.date === todayStr)

  useEffect(() => {
    getRandom(5).then(setFeaturedRecipes).catch((e) => {
      console.warn('[Home] Error cargando recetas:', e)
    })
  }, [])

  // Keep the carousel in sync when the active profile is changed elsewhere
  // (e.g. via the header avatar sheet on this or another screen).
  useEffect(() => {
    if (activeMemberIndex < 0) return
    carouselRef.current?.scrollToIndex({ index: activeMemberIndex, animated: true })
  }, [activeMemberIndex])

  const lowStockAlerts = getLowStockAlerts()
  const allAlerts = [...expiryAlerts, ...lowStockAlerts].slice(0, 5)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Cabecera: avatar + iconos ────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={() => router.push('/scanner')} style={styles.iconBtn}>
              <Ionicons name="camera-outline" size={22} color={colors.text} style={styles.iconInactive} />
            </TouchableOpacity>
          </View>
          <View style={styles.headerRight}>
            <HeaderProfileAvatar />
            {isSuperUser && (
              <TouchableOpacity onPress={() => router.push('/settings')} style={styles.iconBtn}>
                <Ionicons name="settings-outline" size={22} color={colors.text} style={styles.iconInactive} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Saludo familiar ───────────────────── */}
        <View style={styles.greetingSection}>
          <Text style={styles.greetingTitle}>
            {selected
              ? tr.home_screen.greetingWithName(selected.name)
              : familyName
              ? tr.home_screen.greetingWithName(familyName)
              : tr.home_screen.greetingEmpty}
          </Text>
          <Text style={styles.greetingSubtitle}>
            {todayPlan ? tr.home_screen.menuReady : tr.home_screen.addRecipesToWeek}
          </Text>
        </View>

        {/* ── Accesos rápidos (2 tiles) ─────────── */}
        <View style={styles.tilesRow}>
          <TouchableOpacity style={styles.tile} onPress={() => router.push('/(tabs)/nutrition')} activeOpacity={0.8}>
            <View style={styles.tileContent}>
              <Text style={styles.tileTitle}>{tr.home_screen.todayMenu}</Text>
              <Text style={styles.tileSubtitle}>
                {todayPlan ? tr.home_screen.viewTodayMeals : tr.home_screen.planYourWeek}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.tile} onPress={() => router.push('/(tabs)/groceries')} activeOpacity={0.8}>
            <View style={styles.tileContent}>
              <Text style={styles.tileTitle}>{tr.home_screen.shoppingList}</Text>
              <Text style={styles.tileSubtitle}>
                {allAlerts.length > 0 ? tr.home_screen.pantryAlertsCount(allAlerts.length) : tr.home_screen.manageIngredients}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* ── Progreso familiar (paginado) ──────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{tr.home_screen.familyProgress} {familyName}</Text>
          {profiles.length > 0 ? (
            <>
              <FlatList
                ref={carouselRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                data={profiles}
                keyExtractor={(m) => m.id}
                initialScrollIndex={activeMemberIndex}
                getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
                onMomentumScrollEnd={(e) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH)
                  const clamped = Math.max(0, Math.min(idx, profiles.length - 1))
                  const next = profiles[clamped]
                  if (next && next.id !== selectedId) select(next.id)
                }}
                renderItem={({ item }) => (
                  <View style={{ width: SCREEN_WIDTH, paddingHorizontal: Spacing.md }}>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => router.push({ pathname: '/profile/[id]', params: { id: item.id } } as never)}
                    >
                      <MemberCardWide member={item} caloriesConsumed={0} />
                    </TouchableOpacity>
                  </View>
                )}
              />
              {profiles.length > 1 && (
                <View style={styles.dots}>
                  {profiles.map((_, i) => (
                    <View key={i} style={[styles.dot, i === activeMemberIndex && styles.dotActive]} />
                  ))}
                </View>
              )}
            </>
          ) : (
            <Text style={styles.emptyText}>{tr.app.loading}</Text>
          )}
        </View>

        {/* ── Menú de hoy ──────────────────────── */}
        {todayPlan && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{tr.home_screen.todayMenu}</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/nutrition')}>
                <Text style={styles.seeAll}>{tr.home_screen.viewAll}</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              data={(['breakfast', 'lunch', 'dinner'] as const)}
              keyExtractor={(m) => m}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH)
                setActiveMealIndex(Math.max(0, Math.min(idx, 2)))
              }}
              renderItem={({ item: mealType }) => (
                <View style={{ width: SCREEN_WIDTH, paddingHorizontal: Spacing.md }}>
                  <MealCard
                    mealType={mealType}
                    recipe={todayPlan.meals[mealType]}
                    members={profiles}
                    onPress={() => {
                      const recipe = todayPlan.meals[mealType]
                      if (recipe) router.push(`/recipe/${recipe.id}`)
                    }}
                  />
                </View>
              )}
            />
            <View style={styles.dots}>
              {(['breakfast', 'lunch', 'dinner'] as const).map((_, i) => (
                <View key={i} style={[styles.dot, i === activeMealIndex && styles.dotActive]} />
              ))}
            </View>
          </View>
        )}

        {/* ── Recetas recomendadas ─────────────── */}
        {featuredRecipes.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{tr.home_screen.recipesForYou}</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/recipes')}>
                <Text style={styles.seeAll}>{tr.home_screen.viewAllRecipes}</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={featuredRecipes}
              keyExtractor={(r) => r.id}
              contentContainerStyle={styles.carouselContent}
              snapToInterval={176}
              decelerationRate="fast"
              renderItem={({ item }) => (
                <RecipeCard
                  recipe={item}
                  compact
                  onPress={() => router.push(`/recipe/${item.id}`)}
                />
              )}
            />
          </View>
        )}

        {/* ── Alertas de despensa ──────────────── */}
        {allAlerts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{tr.home_screen.pantryAlerts}</Text>
            <View style={styles.alertsCard}>
              {allAlerts.map((item) => {
                const isExpiring = expiryAlerts.some((a) => a.id === item.id)
                return (
                  <View key={item.id} style={styles.alertRow}>
                    <View style={[styles.alertDot, { backgroundColor: isExpiring ? Colors.errorRed : Colors.warningOrange }]} />
                    <Text style={styles.alertText}>
                      {item.name} — {isExpiring ? tr.home_screen.expiresOn(item.expiryDate ?? '') : tr.home_screen.lowStock}
                    </Text>
                    <TouchableOpacity
                      style={styles.alertCTA}
                      onPress={() => router.push('/(tabs)/groceries')}
                    >
                      <Text style={styles.alertCTAText}>{tr.home_screen.buyMore}</Text>
                    </TouchableOpacity>
                  </View>
                )
              })}
            </View>
          </View>
        )}

        {/* ── Noticias de salud ────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{tr.home_screen.healthNews}</Text>
          {NEWS_ITEMS.map((item) => (
            <View key={item.id} style={styles.newsCard}>
              <Text style={styles.newsEmoji}>{item.emoji}</Text>
              <View style={styles.newsContent}>
                <Text style={styles.newsHeadline}>{item.headline}</Text>
                <Text style={styles.newsSource}>{item.source}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Wide member card (paged) ────────────────────────────────────────────────

function MemberCardWide({
  member,
  caloriesConsumed = 0,
}: {
  member: FamilyMember
  caloriesConsumed?: number
}) {
  const tr = useTranslation()
  const { colors } = useTheme()
  const wide = useMemo(() => makeWideStyles(colors), [colors])
  const target = member.dailyCalorieTarget ?? 2000

  return (
    <View style={wide.card}>
      <View style={wide.avatarWrap}>
        <ProgressRing
          value={caloriesConsumed}
          max={target}
          size={100}
          strokeWidth={6}
          color={Colors.goldenAmber}
          trackColor={`${Colors.healthGreen}22`}
          animate
        />
        <View style={wide.avatarOverlay}>
          <Image source={getMemberAvatarSource(member)} style={wide.avatarImage} />
        </View>
      </View>

      <View style={wide.info}>
        <Text style={wide.name}>{member.name}</Text>
        <Text style={wide.meta}>
          {tr.roles[member.role] ?? member.role} · {tr.home_screen.yearsOld(getAge(member.dateOfBirth))}
        </Text>
        <Text style={wide.calories}>{caloriesConsumed} / {target} kcal</Text>
        {member.allergies.length > 0 && (
          <View style={wide.badges}>
            {member.allergies.slice(0, 4).map((a) => (
              <AllergyPill
                key={a}
                label={(tr.allergens as Record<string, string>)[a] ?? a}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: {},

    // Header row
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center' },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    iconBtn: { padding: Spacing.xs },
    iconInactive: { opacity: 0.5 },

    // Greeting
    greetingSection: {
      paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.lg,
    },
    greetingTitle: {
      ...Typography.displaySerif, color: colors.text, marginBottom: 4,
    },
    greetingSubtitle: {
      ...Typography.bodyLarge, color: colors.textSecondary,
    },

    // Quick-access tiles
    tilesRow: {
      flexDirection: 'row', gap: Spacing.sm,
      paddingHorizontal: Spacing.md, marginBottom: Spacing.lg,
    },
    tile: {
      flex: 1, flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.warmSurface, borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm,
      gap: Spacing.xs,
    },
    tileContent: { flex: 1 },
    tileTitle: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily },
    tileSubtitle: { ...Typography.caption, color: colors.textSecondary, marginTop: 2 },

    // Sections
    section: { marginBottom: Spacing.lg },
    sectionHeader: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingRight: Spacing.md, marginBottom: Spacing.sm,
    },
    sectionTitle: {
      ...Typography.heading3, color: colors.text,
      paddingLeft: Spacing.md, marginBottom: Spacing.sm,
    },
    seeAll: { ...Typography.body, color: Colors.healthGreen },
    carouselContent: { paddingHorizontal: Spacing.md, gap: Spacing.sm },

    // Pagination dots
    dots: {
      flexDirection: 'row', justifyContent: 'center',
      gap: 6, marginTop: Spacing.sm,
    },
    dot: {
      width: 7, height: 7, borderRadius: 4,
      backgroundColor: `${Colors.healthGreen}40`,
    },
    dotActive: {
      width: 20, backgroundColor: Colors.healthGreen,
    },

    emptyText: { ...Typography.body, color: colors.textMuted, paddingHorizontal: Spacing.md },

    // Alerts
    alertsCard: {
      marginHorizontal: Spacing.md, backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg, padding: Spacing.md, gap: Spacing.sm, ...Shadows.card,
    },
    alertRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    alertDot: { width: 8, height: 8, borderRadius: 4 },
    alertText: { ...Typography.body, color: colors.text, flex: 1 },
    alertCTA: {
      backgroundColor: `${Colors.healthGreen}18`, paddingHorizontal: Spacing.sm,
      paddingVertical: 4, borderRadius: BorderRadius.pill,
    },
    alertCTAText: { ...Typography.caption, color: Colors.healthGreen, fontFamily: Typography.body.fontFamily },

    // News cards
    newsCard: {
      flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
      marginHorizontal: Spacing.md, backgroundColor: colors.surface,
      borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, ...Shadows.subtle,
    },
    newsEmoji: { fontSize: 28 },
    newsContent: { flex: 1, gap: Spacing.xs },
    newsHeadline: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily },
    newsSource: { ...Typography.caption, color: colors.textSecondary },
  })
}

function makeWideStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.xl,
      padding: Spacing.lg,
      gap: Spacing.lg,
      ...Shadows.card,
    },
    avatarWrap: {
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarImage: {
      width: 72,
      height: 72,
      borderRadius: 36,
    },
    info: {
      flex: 1,
      gap: 4,
    },
    name: {
      ...Typography.heading2,
      color: colors.text,
    },
    meta: {
      ...Typography.caption,
      color: colors.textSecondary,
    },
    calories: {
      ...Typography.body,
      color: colors.text,
      marginTop: 2,
    },
    badges: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
      marginTop: 4,
    },
  })
}
