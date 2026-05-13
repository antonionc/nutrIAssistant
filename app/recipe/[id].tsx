import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { useRecipeDB } from '../../src/modules/recipes/useRecipeDB'
import { useInventory } from '../../src/modules/inventory/InventoryContext'
import { useGroceries } from '../../src/modules/groceries/GroceriesContext'
import { usePlanner } from '../../src/modules/planner/PlannerContext'
import { useProfiles } from '../../src/modules/profiles/ProfilesContext'
import { useSelectedProfile } from '../../src/modules/profiles/SelectedProfileContext'
import { useTranslation, t } from '../../src/i18n'
import { Recipe, RecipeIngredient } from '../../src/types/recipes'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../src/theme'
import { useTheme, ThemeColors } from '../../src/theme/ThemeContext'
import { MEAL_LABELS } from '../../src/constants/mealTypes'
import { translateIngredient, translateUnit } from '../../src/utils/ingredientTranslations'
import { NutriScoreBadge } from '../../src/components/charts/NutriScoreBadge'
import { MacroBar } from '../../src/components/charts/MacroBar'
import { FamilyCompatibilityRow } from '../../src/components/badges/CompatibilityBadge'

// "Powered by Edamam" is the exact phrasing required by Edamam's free-tier
// TOS for attribution on any screen that displays their recipe data.
// Other sources are labelled with their plain name.
const SOURCE_LABEL: Partial<Record<string, string>> = {
  edamam:       'Powered by Edamam',
  spoonacular:  'Spoonacular',
  themealdb:    'TheMealDB',
  ai_generated: '✨ AI',
}

const PARALLAX_HEIGHT = 280
const HEADER_HEIGHT = 64

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { getById, favorite } = useRecipeDB()
  const { items: inventory, decrementIngredients } = useInventory()
  const { addItem: addToGroceries } = useGroceries()
  const { setMealForDate, removeMealFromDate } = usePlanner()
  const { profiles, addFavorite, removeFavorite } = useProfiles()
  const { selectedId } = useSelectedProfile()
  const orderedMembers = useMemo(() => {
    if (!selectedId) return profiles
    const sel = profiles.find((p) => p.id === selectedId)
    if (!sel) return profiles
    return [sel, ...profiles.filter((p) => p.id !== selectedId)]
  }, [profiles, selectedId])
  const { colors } = useTheme()
  const tr = useTranslation()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [servings, setServings] = useState(1)
  const [instructionsExpanded, setInstructionsExpanded] = useState(false)
  const [addedToCart, setAddedToCart] = useState<Set<string>>(new Set())
  // Heart is filled when the recipe lives in EITHER bucket:
  //   - personal: selected member's `favoriteRecipeIds`
  //   - family:   global `recipes.is_favorite` flag (Recipe.isFavorite)
  // Local `isFamilyFavorite` mirrors the global flag for optimistic updates;
  // personal-bucket state is read live from `profiles` so it stays in sync
  // when the user changes the active profile.
  const [isFamilyFavorite, setIsFamilyFavorite] = useState(false)
  const selectedMember = useMemo(
    () => profiles.find((p) => p.id === selectedId) ?? null,
    [profiles, selectedId]
  )
  const isPersonalFavorite = !!(
    recipe && selectedMember?.favoriteRecipeIds.includes(recipe.id)
  )
  const isFavorite = isFamilyFavorite || isPersonalFavorite
  const [planModalVisible, setPlanModalVisible] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().split('T')[0])
  const [selectedMeal, setSelectedMeal] = useState<'breakfast' | 'lunch' | 'dinner'>('lunch')

  const scrollY = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!id) return
    getById(id).then((r) => {
      if (r) {
        setRecipe(r)
        setServings(r.servings)
        setIsFamilyFavorite(r.isFavorite ?? false)
      }
      setIsLoading(false)
    })
  }, [id])

  const scaledNutrition = useCallback(
    (value: number) => {
      if (!recipe) return value
      const ratio = servings / Math.max(recipe.servings, 1)
      return Math.round(value * ratio)
    },
    [servings, recipe]
  )

  const scaledIngredientQty = useCallback(
    (qty: number) => {
      if (!recipe) return qty
      const ratio = servings / Math.max(recipe.servings, 1)
      return Math.round(qty * ratio * 10) / 10
    },
    [servings, recipe]
  )

  const ingredientInPantry = useCallback(
    (ingredient: RecipeIngredient): boolean => {
      return inventory.some(
        (item) =>
          item.name.toLowerCase().includes(ingredient.name.toLowerCase()) ||
          ingredient.name.toLowerCase().includes(item.name.toLowerCase())
      )
    },
    [inventory]
  )

  const handleFavorite = async () => {
    if (!recipe) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    // Already in either bucket → tap removes from BOTH (predictable unfavorite).
    if (isFavorite) {
      if (isFamilyFavorite) {
        await favorite(recipe.id)
        setIsFamilyFavorite(false)
      }
      if (isPersonalFavorite && selectedId) {
        await removeFavorite(selectedId, recipe.id)
      }
      return
    }

    // Not favorited yet → ask which bucket. If no profile is selected we have
    // no personal bucket to target, so default straight to family.
    if (!selectedId) {
      await favorite(recipe.id)
      setIsFamilyFavorite(true)
      return
    }

    Alert.alert(
      tr.recipes.favoritePickerTitle,
      tr.recipes.favoritePickerMsg,
      [
        { text: tr.app.cancel, style: 'cancel' },
        {
          text: tr.recipes.favoritePersonal,
          onPress: async () => {
            await addFavorite(selectedId, recipe.id)
          },
        },
        {
          text: tr.recipes.favoriteFamily,
          onPress: async () => {
            await favorite(recipe.id)
            setIsFamilyFavorite(true)
          },
        },
      ]
    )
  }

  const handleAddIngredientToCart = async (ingredient: RecipeIngredient) => {
    await addToGroceries(ingredient.name, scaledIngredientQty(ingredient.quantity), ingredient.unit)
    setAddedToCart((prev) => new Set(prev).add(ingredient.name))
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  const handleAddAllMissingToCart = async () => {
    if (!recipe) return
    const missing = recipe.ingredients.filter((i) => !ingredientInPantry(i))
    if (missing.length === 0) {
      Alert.alert(tr.recipes.allInPantry, tr.recipes.allInPantryDesc)
      return
    }
    for (const ing of missing) {
      await addToGroceries(ing.name, scaledIngredientQty(ing.quantity), ing.unit)
    }
    setAddedToCart(new Set(missing.map((i) => i.name)))
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Alert.alert(tr.misc.details, tr.recipes.addedToCartCount(missing.length))
  }

  const handleAddToPlan = async () => {
    if (!recipe) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setSelectedDate(new Date().toISOString().split('T')[0])
    setSelectedMeal('lunch')
    setPlanModalVisible(true)
  }

  const confirmAddToPlan = async () => {
    if (!recipe) return
    await setMealForDate(selectedDate, selectedMeal, recipe)
    setPlanModalVisible(false)
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Alert.alert(
      tr.recipes.addedToPlanTitle,
      tr.recipes.addedToPlanFull(recipe.name, MEAL_LABELS[selectedMeal].toLowerCase(), formatDateLabel(selectedDate, true))
    )
  }

  const handleRemoveFromPlan = async (date: string, mealType: 'breakfast' | 'lunch' | 'dinner') => {
    await removeMealFromDate(date, mealType)
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
  }

  const handleCookNow = async () => {
    if (!recipe) return
    Alert.alert(
      tr.recipes.cookNowTitle,
      tr.recipes.cookNowConfirm(recipe.name),
      [
        { text: tr.app.cancel, style: 'cancel' },
        {
          text: tr.recipes.cookNowGo,
          onPress: async () => {
            await decrementIngredients(recipe)
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            Alert.alert(tr.recipes.cookNowSuccess)
          },
        },
      ]
    )
  }

  const imageTranslate = scrollY.interpolate({
    inputRange: [-100, 0, PARALLAX_HEIGHT],
    outputRange: [-30, 0, PARALLAX_HEIGHT * 0.4],
    extrapolate: 'clamp',
  })
  const imageScale = scrollY.interpolate({
    inputRange: [-100, 0],
    outputRange: [1.3, 1],
    extrapolate: 'clamp',
  })
  const headerOpacity = scrollY.interpolate({
    inputRange: [PARALLAX_HEIGHT - 80, PARALLAX_HEIGHT - 20],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  })

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.healthGreen} size="large" />
      </View>
    )
  }

  if (!recipe) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <Text style={styles.errorText}>{tr.recipes.recipeNotFound}</Text>
        <TouchableOpacity style={styles.backBtnFallback} onPress={() => router.back()}>
          <Text style={styles.backBtnFallbackText}>{tr.app.back}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  const totalTime = recipe.prepTime + recipe.cookTime
  const missingCount = recipe.ingredients.filter((i) => !ingredientInPantry(i)).length
  const pantryCount = recipe.ingredients.length - missingCount

  const nextDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  })

  return (
    <View style={styles.container}>
      {/* Sticky header (fades in on scroll) */}
      <Animated.View style={[styles.stickyHeader, { opacity: headerOpacity }]}>
        <SafeAreaView edges={['top']} style={styles.stickyHeaderInner}>
          <TouchableOpacity onPress={() => router.back()} style={styles.stickyBackBtn}>
            <Text style={styles.stickyBackText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.stickyTitle} numberOfLines={1}>{recipe.name}</Text>
          <TouchableOpacity onPress={handleFavorite} style={styles.stickyFavBtn}>
            <Text style={styles.stickyFavText}>{isFavorite ? '♥' : '♡'}</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Animated.View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        {/* Parallax Image */}
        <View style={styles.imageWrapper}>
          <Animated.View
            style={[
              styles.imageContainer,
              { transform: [{ translateY: imageTranslate }, { scale: imageScale }] },
            ]}
          >
            {recipe.imageUrl ? (
              <Image source={{ uri: recipe.imageUrl }} style={styles.heroImage} />
            ) : (
              <View style={[styles.heroImage, styles.imagePlaceholder]}>
                <Text style={styles.imagePlaceholderText}>🍽️</Text>
              </View>
            )}
          </Animated.View>

          {/* Overlay back + fav buttons */}
          <SafeAreaView edges={['top']} style={styles.imageOverlay} pointerEvents="box-none">
            <View style={styles.imageTopBar}>
              <TouchableOpacity onPress={() => router.back()} style={styles.overlayBtn}>
                <Text style={styles.overlayBtnText}>←</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleFavorite} style={styles.overlayBtn}>
                <Text style={[styles.overlayBtnText, isFavorite && styles.favActiveText]}>
                  {isFavorite ? '♥' : '♡'}
                </Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>

        {/* Content Card */}
        <View style={styles.contentCard}>
          {/* Title + meta */}
          <View style={styles.titleRow}>
            <View style={styles.titleBlock}>
              <Text style={styles.recipeName}>{recipe.name}</Text>
              {recipe.cuisine !== 'Unknown' && (
                <Text style={styles.recipeCuisine}>
                  {recipe.cuisineFlag ?? ''} {recipe.cuisine}
                </Text>
              )}
              {recipe.sourceApi && SOURCE_LABEL[recipe.sourceApi] && (
                <Text style={styles.recipeSource}>{SOURCE_LABEL[recipe.sourceApi]}</Text>
              )}
            </View>
            {recipe.nutriscore && (
              <NutriScoreBadge score={recipe.nutriscore} size="lg" />
            )}
          </View>

          {/* Quick stats strip */}
          <View style={styles.statsStrip}>
            <StatChip icon="⏱" label={`${totalTime} min`} sub={tr.recipes.totalTimeLabel} colors={colors} />
            <View style={styles.statDivider} />
            <StatChip icon="👥" label={`${servings}`} sub={tr.recipes.servings} colors={colors} />
            <View style={styles.statDivider} />
            <StatChip icon="🔥" label={`${scaledNutrition(recipe.nutritionalInfo.calories)}`} sub={tr.recipes.kcal} colors={colors} />
            {recipe.tags.length > 0 && (
              <>
                <View style={styles.statDivider} />
                <StatChip icon="🏷️" label={recipe.tags[0]} sub={tr.recipes.tag} colors={colors} />
              </>
            )}
          </View>

          {/* Serving size selector */}
          <View style={styles.servingSelector}>
            <Text style={styles.sectionLabel}>{tr.recipes.servingSize}</Text>
            <View style={styles.servingControl}>
              <TouchableOpacity
                style={styles.servingBtn}
                onPress={() => setServings((s) => Math.max(1, s - 1))}
              >
                <Text style={styles.servingBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.servingCount}>{servings}</Text>
              <TouchableOpacity
                style={styles.servingBtn}
                onPress={() => setServings((s) => s + 1)}
              >
                <Text style={styles.servingBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Macro Bar */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{tr.recipes.nutritionalInfo}</Text>
            <MacroBar nutritionalInfo={recipe.nutritionalInfo} height={10} showLabels />
            <View style={styles.nutritionGrid}>
              <NutritionCell label={tr.nutrients.calories} value={`${scaledNutrition(recipe.nutritionalInfo.calories)}`} unit="kcal" color={Colors.goldenAmber} colors={colors} />
              <NutritionCell label={tr.nutrients.protein} value={`${scaledNutrition(recipe.nutritionalInfo.protein)}`} unit="g" color={Colors.healthGreen} colors={colors} />
              <NutritionCell label={tr.nutrients.carbs} value={`${scaledNutrition(recipe.nutritionalInfo.carbs)}`} unit="g" color={Colors.goldenAmber} colors={colors} />
              <NutritionCell label={tr.nutrients.fat} value={`${scaledNutrition(recipe.nutritionalInfo.fat)}`} unit="g" color="#FF8C42" colors={colors} />
            </View>
            {(recipe.nutritionalInfo.fiber !== undefined || recipe.nutritionalInfo.sodium !== undefined) && (
              <View style={styles.extraNutrition}>
                {recipe.nutritionalInfo.fiber !== undefined && (
                  <View style={styles.extraNutritionItem}>
                    <Text style={styles.extraNutritionLabel}>{tr.nutrients.fiber}</Text>
                    <Text style={styles.extraNutritionValue}>{scaledNutrition(recipe.nutritionalInfo.fiber)}g</Text>
                  </View>
                )}
                {recipe.nutritionalInfo.sodium !== undefined && (
                  <View style={styles.extraNutritionItem}>
                    <Text style={styles.extraNutritionLabel}>{tr.nutrients.sodium}</Text>
                    <Text style={styles.extraNutritionValue}>{scaledNutrition(recipe.nutritionalInfo.sodium)}mg</Text>
                  </View>
                )}
                {recipe.nutritionalInfo.sugar !== undefined && (
                  <View style={styles.extraNutritionItem}>
                    <Text style={styles.extraNutritionLabel}>{tr.nutrients.sugar}</Text>
                    <Text style={styles.extraNutritionValue}>{scaledNutrition(recipe.nutritionalInfo.sugar)}g</Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Family Compatibility */}
          {profiles.length > 0 && recipe.familyCompatibility && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{tr.recipes.familyCompatibility}</Text>
              <FamilyCompatibilityRow
                compatibility={recipe.familyCompatibility}
                members={orderedMembers}
                activeMemberId={selectedId ?? undefined}
                compact={false}
              />
            </View>
          )}

          {/* Allergen Badges */}
          {recipe.allergens.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{tr.recipes.allergens}</Text>
              <View style={styles.allergenRow}>
                {recipe.allergens.map((a) => (
                  <View key={a} style={styles.allergenBadge}>
                    <Text style={styles.allergenText}>{a}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Ingredients */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>
                {tr.recipes.ingredientsCount(recipe.ingredients.length)}
              </Text>
              {recipe.ingredients.length > 0 && (
                <Text style={styles.pantryStatus}>
                  {tr.recipes.inPantryCount(pantryCount, recipe.ingredients.length)}
                </Text>
              )}
            </View>

            {recipe.ingredients.length === 0 && (
              <View style={styles.noIngredientsNote}>
                <Text style={styles.noIngredientsText}>{tr.recipes.noIngredientsNote}</Text>
              </View>
            )}

            {recipe.ingredients.map((ingredient, index) => {
              const inPantry = ingredientInPantry(ingredient)
              const inCart = addedToCart.has(ingredient.name)
              return (
                <View key={`${ingredient.name}-${index}`} style={styles.ingredientRow}>
                  <View style={[styles.ingredientDot, inPantry && styles.ingredientDotPantry, ingredient.isAllergen && styles.ingredientDotAllergen]} />
                  <View style={styles.ingredientInfo}>
                    <Text style={styles.ingredientName}>{translateIngredient(ingredient.name)}</Text>
                    <Text style={styles.ingredientQty}>
                      {scaledIngredientQty(ingredient.quantity)} {translateUnit(ingredient.unit)}
                    </Text>
                  </View>
                  <View style={styles.ingredientBadges}>
                    {inPantry && (
                      <View style={styles.pantryBadge}>
                        <Text style={styles.pantryBadgeText}>{tr.recipes.inPantry}</Text>
                      </View>
                    )}
                    {ingredient.isAllergen && (
                      <View style={styles.allergenSmallBadge}>
                        <Text style={styles.allergenSmallText}>⚠</Text>
                      </View>
                    )}
                    {!inPantry && !inCart && (
                      <TouchableOpacity
                        style={styles.addCartBtn}
                        onPress={() => handleAddIngredientToCart(ingredient)}
                      >
                        <Text style={styles.addCartBtnText}>{tr.recipes.addToCart}</Text>
                      </TouchableOpacity>
                    )}
                    {inCart && (
                      <View style={styles.inCartBadge}>
                        <Text style={styles.inCartText}>🛒</Text>
                      </View>
                    )}
                  </View>
                </View>
              )
            })}

            {missingCount > 0 && (
              <TouchableOpacity style={styles.addAllMissingBtn} onPress={handleAddAllMissingToCart}>
                <Text style={styles.addAllMissingText}>{tr.recipes.missingToCart(missingCount)}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Instructions */}
          {recipe.instructions.length > 0 && (
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.sectionHeaderRow}
                onPress={() => setInstructionsExpanded((prev) => !prev)}
              >
                <Text style={styles.sectionLabel}>{tr.recipes.instructionsCount(recipe.instructions.length)}</Text>
                <Text style={styles.expandToggle}>{instructionsExpanded ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {instructionsExpanded &&
                recipe.instructions.map((step, index) => (
                  <View key={index} style={styles.stepRow}>
                    <View style={styles.stepNumber}>
                      <Text style={styles.stepNumberText}>{index + 1}</Text>
                    </View>
                    <Text style={styles.stepText}>{step}</Text>
                  </View>
                ))}

              {!instructionsExpanded && (
                <Text style={styles.instructionsPreview} numberOfLines={2}>
                  {recipe.instructions[0]}
                </Text>
              )}
            </View>
          )}

          <View style={{ height: 120 }} />
        </View>
      </Animated.ScrollView>

      {/* Add to Plan Modal */}
      <Modal
        visible={planModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPlanModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setPlanModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>{tr.recipes.addToWeekPlan}</Text>
            <Text style={styles.modalRecipeName} numberOfLines={1}>{recipe.name}</Text>

            {/* Day selector */}
            <Text style={styles.modalSectionLabel}>{tr.recipes.dayLabel}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll}>
              {nextDays.map((date) => (
                <TouchableOpacity
                  key={date}
                  style={[styles.dayPill, selectedDate === date && styles.dayPillSelected]}
                  onPress={() => setSelectedDate(date)}
                >
                  <Text style={[styles.dayPillLabel, selectedDate === date && styles.dayPillLabelSelected]}>
                    {formatDateLabel(date, false)}
                  </Text>
                  <Text style={[styles.dayPillDate, selectedDate === date && styles.dayPillLabelSelected]}>
                    {new Date(date + 'T12:00:00').getDate()}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Meal selector */}
            <Text style={styles.modalSectionLabel}>{tr.recipes.mealLabel}</Text>
            <View style={styles.mealRow}>
              {(['breakfast', 'lunch', 'dinner'] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.mealBtn, selectedMeal === m && styles.mealBtnSelected]}
                  onPress={() => setSelectedMeal(m)}
                >
                  <Text style={[styles.mealBtnLabel, selectedMeal === m && styles.mealBtnLabelSelected]}>
                    {MEAL_LABELS[m]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Confirm / Cancel */}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setPlanModalVisible(false)}>
                <Text style={styles.modalCancelText}>{tr.app.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={confirmAddToPlan}>
                <Text style={styles.modalConfirmText}>{tr.recipes.addBtn}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Sticky Action Bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleAddToPlan}>
          <Text style={styles.actionBtnSecondaryText}>{tr.recipes.planBtn}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleAddAllMissingToCart}>
          <Text style={styles.actionBtnSecondaryText}>{tr.recipes.buyBtn}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtnPrimary} onPress={handleCookNow}>
          <Text style={styles.actionBtnPrimaryText}>{tr.recipes.cookBtn}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function formatDateLabel(dateStr: string, long: boolean): string {
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  if (dateStr === today) return t.recipes.today
  if (dateStr === tomorrow) return t.recipes.tomorrow
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString(undefined, long ? { weekday: 'short', day: 'numeric' } : { weekday: 'short' })
}

function StatChip({ icon, label, sub, colors }: { icon: string; label: string; sub: string; colors: ThemeColors }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={styles.statChip}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  )
}

function NutritionCell({ label, value, unit, color, colors }: { label: string; value: string; unit: string; color: string; colors: ThemeColors }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={[styles.nutritionCell, { borderTopColor: color }]}>
      <Text style={styles.nutritionValue}>{value}</Text>
      <Text style={styles.nutritionUnit}>{unit}</Text>
      <Text style={styles.nutritionLabel}>{label}</Text>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { ...Typography.heading2, color: colors.text, marginBottom: Spacing.md },
    backBtnFallback: { padding: Spacing.sm },
    backBtnFallbackText: { ...Typography.bodyLarge, color: Colors.healthGreen },

    stickyHeader: {
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
      backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border,
      ...Shadows.subtle,
    },
    stickyHeaderInner: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md,
      height: HEADER_HEIGHT, gap: Spacing.sm,
    },
    stickyBackBtn: { padding: Spacing.sm },
    stickyBackText: { fontSize: 22, color: colors.text },
    stickyTitle: { flex: 1, ...Typography.heading3, color: colors.text },
    stickyFavBtn: { padding: Spacing.sm },
    stickyFavText: { fontSize: 22, color: Colors.healthGreen },

    imageWrapper: { height: PARALLAX_HEIGHT, overflow: 'hidden' },
    imageContainer: { position: 'absolute', top: 0, left: 0, right: 0, height: PARALLAX_HEIGHT + 40 },
    heroImage: { width: '100%', height: PARALLAX_HEIGHT + 40, resizeMode: 'cover' },
    imagePlaceholder: { backgroundColor: colors.mintSurface, alignItems: 'center', justifyContent: 'center' },
    imagePlaceholderText: { fontSize: 80 },
    imageOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
    imageTopBar: {
      flexDirection: 'row', justifyContent: 'space-between',
      paddingHorizontal: Spacing.md, paddingTop: Spacing.sm,
    },
    overlayBtn: {
      width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)',
      alignItems: 'center', justifyContent: 'center',
    },
    overlayBtnText: { color: Colors.white, fontSize: 18 },
    favActiveText: { color: '#FF6B6B' },

    contentCard: {
      backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      marginTop: -24, paddingHorizontal: Spacing.md, paddingTop: Spacing.lg,
    },
    titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.sm, marginBottom: Spacing.sm },
    titleBlock: { flex: 1 },
    recipeName: { ...Typography.heading1, color: colors.text, flexWrap: 'wrap' },
    recipeCuisine: { ...Typography.body, color: colors.textSecondary, marginTop: 2 },
    recipeSource: { fontSize: 11, color: colors.textMuted, letterSpacing: 0.2, marginTop: 2 },

    statsStrip: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg, padding: Spacing.sm, marginBottom: Spacing.md,
      ...Shadows.subtle,
    },
    statChip: { flex: 1, alignItems: 'center', gap: 2 },
    statDivider: { width: 1, height: 36, backgroundColor: colors.border },
    statIcon: { fontSize: 18 },
    statLabel: { ...Typography.heading3, color: colors.text, fontSize: 14 },
    statSub: { ...Typography.caption, color: colors.textSecondary },

    servingSelector: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: Spacing.md,
    },
    servingControl: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    servingBtn: {
      width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.healthGreen,
      alignItems: 'center', justifyContent: 'center',
    },
    servingBtnText: { color: Colors.white, fontSize: 18, lineHeight: 20 },
    servingCount: { ...Typography.heading2, color: colors.text, minWidth: 28, textAlign: 'center' },

    section: { marginBottom: Spacing.lg },
    sectionLabel: { ...Typography.heading3, color: colors.text, marginBottom: Spacing.sm },
    sectionHeaderRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: Spacing.sm,
    },
    pantryStatus: { ...Typography.caption, color: Colors.healthGreen },
    expandToggle: { ...Typography.body, color: colors.textSecondary },

    nutritionGrid: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
    nutritionCell: {
      flex: 1, backgroundColor: colors.surface, borderRadius: BorderRadius.md,
      padding: Spacing.sm, alignItems: 'center', borderTopWidth: 3, ...Shadows.subtle,
    },
    nutritionValue: { ...Typography.heading2, color: colors.text, fontSize: 18 },
    nutritionUnit: { ...Typography.caption, color: colors.textSecondary, fontSize: 10 },
    nutritionLabel: { ...Typography.caption, color: colors.textSecondary, marginTop: 2 },

    extraNutrition: {
      flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm,
      backgroundColor: colors.mintSurface, borderRadius: BorderRadius.md, padding: Spacing.sm,
    },
    extraNutritionItem: { flex: 1, alignItems: 'center' },
    extraNutritionLabel: { ...Typography.caption, color: colors.textSecondary },
    extraNutritionValue: { ...Typography.bodyLarge, color: colors.text, fontFamily: Typography.heading3.fontFamily },

    allergenRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
    allergenBadge: {
      backgroundColor: `${Colors.errorRed}15`, borderRadius: BorderRadius.pill,
      paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: `${Colors.errorRed}40`,
    },
    allergenText: { ...Typography.caption, color: Colors.errorRed },

    ingredientRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      backgroundColor: colors.surface, borderRadius: BorderRadius.md,
      padding: Spacing.sm, marginBottom: Spacing.xs, ...Shadows.subtle,
    },
    ingredientDot: {
      width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border,
    },
    ingredientDotPantry: { backgroundColor: Colors.healthGreen },
    ingredientDotAllergen: { backgroundColor: Colors.errorRed },
    ingredientInfo: { flex: 1 },
    ingredientName: { ...Typography.bodyLarge, color: colors.text },
    ingredientQty: { ...Typography.caption, color: colors.textSecondary },
    ingredientBadges: { flexDirection: 'row', gap: Spacing.xs, alignItems: 'center' },
    pantryBadge: {
      backgroundColor: `${Colors.healthGreen}20`, borderRadius: BorderRadius.pill,
      paddingHorizontal: Spacing.xs, paddingVertical: 2,
    },
    pantryBadgeText: { ...Typography.overline, color: Colors.healthGreen, fontSize: 9 },
    allergenSmallBadge: {
      width: 22, height: 22, borderRadius: 11, backgroundColor: `${Colors.errorRed}20`,
      alignItems: 'center', justifyContent: 'center',
    },
    allergenSmallText: { fontSize: 12, color: Colors.errorRed },
    addCartBtn: {
      backgroundColor: colors.mintSurface, borderRadius: BorderRadius.pill,
      paddingHorizontal: Spacing.xs, paddingVertical: 3,
    },
    addCartBtnText: { ...Typography.overline, color: Colors.healthGreen, fontSize: 9 },
    inCartBadge: { padding: 2 },
    inCartText: { fontSize: 14 },
    addAllMissingBtn: {
      backgroundColor: Colors.healthGreen, borderRadius: BorderRadius.pill,
      padding: Spacing.sm, alignItems: 'center', marginTop: Spacing.sm,
    },
    addAllMissingText: { ...Typography.body, color: Colors.white, fontFamily: Typography.heading3.fontFamily },

    noIngredientsNote: {
      backgroundColor: `${Colors.goldenAmber}15`,
      borderRadius: BorderRadius.md,
      padding: Spacing.sm,
      borderWidth: 1,
      borderColor: `${Colors.goldenAmber}40`,
      marginBottom: Spacing.sm,
    },
    noIngredientsText: { ...Typography.body, color: colors.text, fontStyle: 'italic' },

    instructionsPreview: { ...Typography.body, color: colors.textSecondary, fontStyle: 'italic' },
    stepRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
    stepNumber: {
      width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.healthGreen,
      alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
    },
    stepNumberText: { ...Typography.caption, color: Colors.white, fontFamily: Typography.heading3.fontFamily },
    stepText: { ...Typography.body, color: colors.text, flex: 1, lineHeight: 22 },

    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center', justifyContent: 'center', padding: Spacing.lg,
    },
    modalCard: {
      backgroundColor: colors.background, borderRadius: BorderRadius.xl,
      padding: Spacing.lg, width: '100%', ...Shadows.elevated,
    },
    modalTitle: { ...Typography.heading2, color: colors.text, marginBottom: 4 },
    modalRecipeName: { ...Typography.body, color: colors.textSecondary, marginBottom: Spacing.md },
    modalSectionLabel: { ...Typography.overline, color: colors.textSecondary, marginBottom: Spacing.xs },
    dayScroll: { marginBottom: Spacing.md },
    dayPill: {
      alignItems: 'center', paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
      borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: colors.border,
      marginRight: Spacing.xs, backgroundColor: colors.surface, minWidth: 52,
    },
    dayPillSelected: { backgroundColor: Colors.healthGreen, borderColor: Colors.healthGreen },
    dayPillLabel: { ...Typography.overline, color: colors.textSecondary },
    dayPillDate: { ...Typography.heading3, color: colors.text, fontSize: 16 },
    dayPillLabelSelected: { color: Colors.white },
    mealRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
    mealBtn: {
      flex: 1, alignItems: 'center', paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    mealBtnSelected: { backgroundColor: Colors.healthGreen, borderColor: Colors.healthGreen },
    mealBtnLabel: { ...Typography.body, color: colors.text, textAlign: 'center' },
    mealBtnLabelSelected: { color: Colors.white, fontFamily: Typography.heading3.fontFamily },
    modalActions: { flexDirection: 'row', gap: Spacing.sm },
    modalCancelBtn: {
      flex: 1, padding: Spacing.sm, borderRadius: BorderRadius.pill,
      backgroundColor: colors.mintSurface, alignItems: 'center',
    },
    modalCancelText: { ...Typography.body, color: colors.text },
    modalConfirmBtn: {
      flex: 2, padding: Spacing.sm, borderRadius: BorderRadius.pill,
      backgroundColor: Colors.healthGreen, alignItems: 'center',
    },
    modalConfirmText: { ...Typography.bodyLarge, color: Colors.white, fontFamily: Typography.heading3.fontFamily },

    actionBar: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border,
      paddingHorizontal: Spacing.md, paddingBottom: Spacing.lg, paddingTop: Spacing.sm,
      flexDirection: 'row', gap: Spacing.sm, ...Shadows.elevated,
    },
    actionBtnSecondary: {
      flex: 1, backgroundColor: colors.mintSurface, borderRadius: BorderRadius.pill,
      padding: Spacing.sm, alignItems: 'center',
    },
    actionBtnSecondaryText: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily },
    actionBtnPrimary: {
      flex: 2, backgroundColor: Colors.healthGreen, borderRadius: BorderRadius.pill,
      padding: Spacing.sm, alignItems: 'center',
    },
    actionBtnPrimaryText: { ...Typography.bodyLarge, color: Colors.white, fontFamily: Typography.heading3.fontFamily },
  })
}
