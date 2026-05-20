import React, { useMemo } from 'react'
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
import { useResolvedRecipeImage } from '../../modules/recipes/useResolvedRecipeImage'

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
