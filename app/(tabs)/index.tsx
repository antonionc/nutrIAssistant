import React, { useEffect, useState } from 'react'
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
import { useInventory } from '../../src/modules/inventory/useInventory'
import { usePlanner } from '../../src/modules/planner/PlannerContext'
import { useRecipeDB } from '../../src/modules/recipes/useRecipeDB'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../src/theme'
import { ProgressRing } from '../../src/components/charts/ProgressRing'
import { MealCard } from '../../src/components/cards/MealCard'
import { RecipeCard } from '../../src/components/cards/RecipeCard'
import { FamilyMember } from '../../src/types/profiles'
import { Recipe } from '../../src/types/recipes'

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
  const { expiryAlerts, getLowStockAlerts } = useInventory()
  const { weekPlans } = usePlanner()
  const { getRandom } = useRecipeDB()
  const [featuredRecipes, setFeaturedRecipes] = useState<Recipe[]>([])
  const [activeMemberIndex, setActiveMemberIndex] = useState(0)
  const [activeMealIndex, setActiveMealIndex] = useState(0)

  const todayStr = new Date().toISOString().split('T')[0]
  const todayPlan = weekPlans.find((p) => p.date === todayStr)

  useEffect(() => {
    getRandom(5).then(setFeaturedRecipes).catch((e) => {
      console.warn('[Home] Error cargando recetas:', e)
    })
  }, [])

  const lowStockAlerts = getLowStockAlerts()
  const allAlerts = [...expiryAlerts, ...lowStockAlerts].slice(0, 5)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Cabecera de iconos ───────────────── */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.push('/scanner')} style={styles.iconBtn}>
            <Ionicons name="camera-outline" size={24} color={Colors.warmCharcoal} style={styles.iconInactive} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/settings')} style={styles.iconBtn}>
            <Ionicons name="settings-outline" size={24} color={Colors.warmCharcoal} style={styles.iconInactive} />
          </TouchableOpacity>
        </View>

        {/* ── Progreso familiar (paginado) ──────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{tr.home_screen.familyProgress} {familyName}</Text>
          {profiles.length > 0 ? (
            <>
              <FlatList
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                data={profiles}
                keyExtractor={(m) => m.id}
                onMomentumScrollEnd={(e) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH)
                  setActiveMemberIndex(Math.max(0, Math.min(idx, profiles.length - 1)))
                }}
                renderItem={({ item }) => (
                  <View style={{ width: SCREEN_WIDTH, paddingHorizontal: Spacing.md }}>
                    <MemberCardWide member={item} caloriesConsumed={0} />
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
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{tr.home_screen.todayMenu}</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/nutrition')}>
              <Text style={styles.seeAll}>{tr.home_screen.viewAll}</Text>
            </TouchableOpacity>
          </View>
          {todayPlan ? (
            <>
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
            </>
          ) : (
            <View style={styles.noMealCard}>
              <Text style={styles.noMealText}>{tr.home_screen.noMealToday}</Text>
              <TouchableOpacity
                style={styles.ctaBtn}
                onPress={() => router.push('/(tabs)/nutrition')}
              >
                <Text style={styles.ctaBtnText}>{tr.home_screen.generatePlan}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

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
              snapToInterval={SCREEN_WIDTH}
              decelerationRate="fast"
              renderItem={({ item }) => (
                <View style={{ width: SCREEN_WIDTH }}>
                  <RecipeCard
                    recipe={item}
                    onPress={() => router.push(`/recipe/${item.id}`)}
                  />
                </View>
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
          {member.avatarUrl ? (
            <Image source={{ uri: member.avatarUrl }} style={wide.avatarImage} />
          ) : (
            <Text style={wide.avatarEmoji}>{member.avatarEmoji ?? '👤'}</Text>
          )}
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
              <View key={a} style={wide.badge}>
                <Text style={wide.badgeText}>
                  {(tr.allergens as Record<string, string>)[a] ?? a}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  scroll: {},
  header: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm,
  },
  iconBtn: { padding: Spacing.xs },
  iconInactive: { opacity: 0.55 },
  section: { marginBottom: Spacing.lg },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.heading3, color: Colors.warmCharcoal,
    paddingLeft: Spacing.md, marginBottom: Spacing.sm,
  },
  seeAll: { ...Typography.body, color: Colors.healthGreen, paddingRight: Spacing.md },
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
  emptyText: { ...Typography.body, color: Colors.light.textMuted, paddingHorizontal: Spacing.md },
  noMealCard: {
    marginHorizontal: Spacing.md, padding: Spacing.lg, backgroundColor: Colors.white,
    borderRadius: BorderRadius.lg, alignItems: 'center', gap: Spacing.md, ...Shadows.card,
  },
  noMealText: { ...Typography.body, color: Colors.light.textSecondary },
  ctaBtn: { backgroundColor: Colors.healthGreen, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, borderRadius: BorderRadius.pill },
  ctaBtnText: { ...Typography.body, color: Colors.white, fontFamily: Typography.heading3.fontFamily },
  // Alerts
  alertsCard: {
    marginHorizontal: Spacing.md, backgroundColor: Colors.white,
    borderRadius: BorderRadius.lg, padding: Spacing.md, gap: Spacing.sm, ...Shadows.card,
  },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  alertDot: { width: 8, height: 8, borderRadius: 4 },
  alertText: { ...Typography.body, color: Colors.warmCharcoal, flex: 1 },
  alertCTA: {
    backgroundColor: `${Colors.healthGreen}18`, paddingHorizontal: Spacing.sm,
    paddingVertical: 4, borderRadius: BorderRadius.pill,
  },
  alertCTAText: { ...Typography.caption, color: Colors.healthGreen, fontFamily: Typography.body.fontFamily },
  // News
  newsCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    marginHorizontal: Spacing.md, backgroundColor: Colors.white,
    borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, ...Shadows.subtle,
  },
  newsEmoji: { fontSize: 28 },
  newsContent: { flex: 1, gap: Spacing.xs },
  newsHeadline: { ...Typography.body, color: Colors.warmCharcoal, fontFamily: Typography.heading3.fontFamily },
  newsSource: { ...Typography.caption, color: Colors.light.textSecondary },
})

const wide = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
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
  avatarEmoji: {
    fontSize: 36,
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    ...Typography.heading2,
    color: Colors.warmCharcoal,
  },
  meta: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
  },
  calories: {
    ...Typography.body,
    color: Colors.warmCharcoal,
    marginTop: 2,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: 4,
  },
  badge: {
    backgroundColor: `${Colors.errorRed}18`,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.pill,
  },
  badgeText: {
    ...Typography.caption,
    color: Colors.errorRed,
    fontFamily: Typography.heading3.fontFamily,
  },
})
