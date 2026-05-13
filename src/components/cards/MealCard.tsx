import React, { useEffect, useMemo, useState } from 'react'
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Recipe } from '../../types/recipes'
import { FamilyMember } from '../../types/profiles'
import { MealType } from '../../types/planner'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../theme'
import { useTheme, ThemeColors } from '../../theme/ThemeContext'
import { MEAL_LABELS } from '../../constants/mealTypes'
import { FamilyCompatibilityRow } from '../badges/CompatibilityBadge'
import { NutriScoreBadge } from '../charts/NutriScoreBadge'
import { useTranslation } from '../../i18n'
import { getRecipeById } from '../../modules/recipes/recipeDB'
import { enrichRecipeDetail, enrichSpoonacularDetail } from '../../modules/recipes/syncRecipes'

interface MealCardProps {
  mealType: MealType
  recipe?: Recipe
  members?: FamilyMember[]
  activeMemberId?: string
  onPress?: () => void
  onSuggestAlternative?: () => void
  onLock?: () => void
  isLocked?: boolean
  isGenerating?: boolean
}

export function MealCard({
  mealType,
  recipe,
  members = [],
  activeMemberId,
  onPress,
  onSuggestAlternative,
  onLock,
  isLocked = false,
  isGenerating = false,
}: MealCardProps) {
  const { colors } = useTheme()
  const tr = useTranslation()
  const styles = useMemo(() => makeStyles(colors), [colors])

  // Some plan snapshots were saved before Edamam/Spoonacular populated their
  // imageUrl. The detail screen enriches them lazily on first open; this
  // card does the same so the thumbnail appears without requiring the user
  // to visit the detail view first.
  const resolvedImageUrl = useResolvedRecipeImage(recipe)

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
      {/* Row 1: meal label + macro pills + lock */}
      <View style={styles.header}>
        <Text style={styles.mealLabel}>{MEAL_LABELS[mealType]}</Text>
        <View style={styles.headerRight}>
          {recipe && !isGenerating && (
            <View style={styles.macroPills}>
              <MacroPill color={Colors.healthGreen} label="P" value={recipe.nutritionalInfo.protein} colors={colors} />
              <MacroPill color={Colors.goldenAmber} label="C" value={recipe.nutritionalInfo.carbs} colors={colors} />
              <MacroPill color={Colors.warningOrange} label="G" value={recipe.nutritionalInfo.fat} colors={colors} />
            </View>
          )}
          {onLock && (
            <TouchableOpacity onPress={onLock} style={styles.iconBtn}>
              <Ionicons
                name={isLocked ? 'lock-closed' : 'lock-open-outline'}
                size={16}
                color={colors.textMuted}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isGenerating ? (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>{tr.nutrition.generatingPlan}</Text>
        </View>
      ) : recipe ? (
        <>
          {/* Row 2: image + name/meta/nutriscore */}
          <View style={styles.recipeRow}>
            {resolvedImageUrl && (
              <Image source={{ uri: resolvedImageUrl }} style={styles.recipeImage} />
            )}
            <View style={styles.recipeInfo}>
              <Text style={styles.recipeName} numberOfLines={2}>{recipe.name}</Text>
              <Text style={styles.metaText}>{recipe.prepTime + recipe.cookTime} min · {recipe.nutritionalInfo.calories} kcal</Text>
              {recipe.nutriscore && (
                <View style={{ marginTop: 4 }}>
                  <NutriScoreBadge score={recipe.nutriscore} size="sm" />
                </View>
              )}
            </View>
          </View>

          {members.length > 0 && recipe.familyCompatibility && (
            <FamilyCompatibilityRow
              compatibility={recipe.familyCompatibility}
              members={members}
              activeMemberId={activeMemberId}
              compact
            />
          )}

          {onSuggestAlternative && !isLocked && (
            <TouchableOpacity style={styles.alternativeBtn} onPress={onSuggestAlternative}>
              <Text style={styles.alternativeBtnText}>{tr.mealCard.suggestAlternative}</Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        <TouchableOpacity style={styles.emptySlot} onPress={onSuggestAlternative}>
          <Text style={styles.emptyText}>{tr.mealCard.addMeal}</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  )
}

// Module-level cache of resolved thumbnail URLs, keyed by recipe id.
// Survives MealCard unmount/remount, so a card that resolved its
// thumbnail via lazy enrichment in a previous mount renders it instantly
// the next time it appears — no blank-then-resolve flicker when the user
// navigates away and comes back.
//
// The Recipe.imageUrl on the meal-plan snapshot is NOT updated when
// lazy enrichment succeeds (the live `recipes` table row IS updated,
// but the plan's frozen snapshot is not). Without this cache, every
// remount would have to re-walk the DB and possibly re-enrich.
const resolvedImageCache = new Map<string, string>()

function rememberResolvedImage(recipeId: string, url: string | undefined): void {
  if (!url) return
  resolvedImageCache.set(recipeId, url)
}

/**
 * Resolves the thumbnail URL for a meal-plan recipe.
 *
 * Resolution paths, tried in order:
 *   1. The snapshot already has `imageUrl` — fast path, no DB roundtrip.
 *      (Common case once `plannerDB.hydratePlanImages` ran against an
 *      enriched catalog row.)
 *   2. The module-level cache has a previously-resolved URL for this
 *      recipe id — instant on remount.
 *   3. The live catalog row has it — happens when the recipe was
 *      enriched after the plan was first generated.
 *   4. Both snapshot and catalog row are stubs — kicks off the same
 *      lazy `enrichRecipeDetail`/`enrichSpoonacularDetail` flow the
 *      detail screen uses, then re-reads.
 */
function useResolvedRecipeImage(recipe: Recipe | undefined): string | undefined {
  const [imageUrl, setImageUrl] = useState<string | undefined>(() => {
    if (!recipe) return undefined
    return recipe.imageUrl ?? resolvedImageCache.get(recipe.id)
  })

  // Effect depends ONLY on `recipe?.id`. Ignoring `recipe.imageUrl`
  // changes here means once we've resolved an image, a later re-render
  // where the snapshot's `imageUrl` flips back to undefined (e.g. plan
  // reloaded before the catalog row caught up) cannot flash the image
  // off.
  useEffect(() => {
    if (!recipe) {
      setImageUrl(undefined)
      return
    }

    // 1. Snapshot has it — use directly, and remember for next mount.
    if (recipe.imageUrl) {
      setImageUrl(recipe.imageUrl)
      rememberResolvedImage(recipe.id, recipe.imageUrl)
      return
    }

    // 2. Module cache has a previously-resolved URL — show it now so
    //    the user sees a thumbnail immediately, but still revalidate
    //    against the DB in case it changed.
    const cached = resolvedImageCache.get(recipe.id)
    if (cached) {
      setImageUrl(cached)
    } else {
      // Truly nothing cached — clear any image carried over from a
      // previous recipe slot before the async resolution lands.
      setImageUrl(undefined)
    }

    let cancelled = false
    void (async () => {
      // 3. Check the live recipes row — it may have been enriched
      //    during a previous session.
      const live = await getRecipeById(recipe.id)
      if (cancelled) return
      if (live?.imageUrl) {
        setImageUrl(live.imageUrl)
        rememberResolvedImage(recipe.id, live.imageUrl)
        return
      }

      // 4. Still a stub — trigger the same lazy enrichment the detail
      //    screen does, so the thumbnail appears the first time the
      //    user lands on a freshly-synced plan instead of waiting
      //    until they open the recipe detail.
      if (!live?.sourceId) return
      const ok =
        live.sourceApi === 'edamam'
          ? await enrichRecipeDetail(live.id, live.sourceId)
          : live.sourceApi === 'spoonacular'
            ? await enrichSpoonacularDetail(live.id, live.sourceId)
            : false
      if (cancelled || !ok) return
      const refreshed = await getRecipeById(recipe.id)
      if (cancelled) return
      if (refreshed?.imageUrl) {
        setImageUrl(refreshed.imageUrl)
        rememberResolvedImage(recipe.id, refreshed.imageUrl)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.id])

  return imageUrl
}

function MacroPill({
  color,
  label,
  value,
  colors,
}: {
  color: string
  label: string
  value: number
  colors: ThemeColors
}) {
  return (
    <View style={[pillStyles.pill, { backgroundColor: colors.warmSurface }]}>
      <View style={[pillStyles.dot, { backgroundColor: color }]} />
      <Text style={[pillStyles.text, { color: colors.text }]}>
        {label} {Math.round(value)}g
      </Text>
    </View>
  )
}

const pillStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { ...Typography.caption, fontSize: 11 },
})

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: BorderRadius.xl,
      padding: Spacing.sm,
      gap: Spacing.sm,
      ...Shadows.card,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    mealLabel: {
      ...Typography.heading3,
      color: colors.text,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      flexShrink: 1,
    },
    macroPills: {
      flexDirection: 'row',
      gap: 4,
      flexShrink: 1,
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
    },
    iconBtn: {
      padding: Spacing.xs,
    },
    recipeRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      alignItems: 'flex-start',
    },
    recipeImage: {
      width: 60,
      height: 60,
      borderRadius: BorderRadius.md,
      flexShrink: 0,
    },
    recipeInfo: {
      flex: 1,
      gap: 3,
    },
    recipeName: {
      ...Typography.body,
      color: colors.text,
      fontFamily: Typography.heading3.fontFamily,
      lineHeight: 18,
    },
    metaText: {
      ...Typography.caption,
      color: colors.textSecondary,
    },
    alternativeBtn: {
      alignSelf: 'flex-end',
      paddingVertical: 4,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.pill,
      backgroundColor: colors.mintSurface,
    },
    alternativeBtnText: {
      ...Typography.caption,
      color: Colors.healthGreen,
      fontFamily: Typography.body.fontFamily,
    },
    loading: {
      padding: Spacing.sm,
      alignItems: 'center',
    },
    loadingText: {
      ...Typography.body,
      color: colors.textSecondary,
    },
    emptySlot: {
      padding: Spacing.md,
      alignItems: 'center',
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
    },
    emptyText: {
      ...Typography.body,
      color: colors.textMuted,
    },
  })
}
