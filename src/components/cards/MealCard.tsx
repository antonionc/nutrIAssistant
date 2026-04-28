import React, { useMemo } from 'react'
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Recipe } from '../../types/recipes'
import { FamilyMember } from '../../types/profiles'
import { MealType } from '../../types/planner'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../theme'
import { useTheme, ThemeColors } from '../../theme/ThemeContext'
import { MEAL_LABELS, MEAL_EMOJIS } from '../../constants/mealTypes'
import { MacroBar } from '../charts/MacroBar'
import { FamilyCompatibilityRow } from '../badges/CompatibilityBadge'
import { NutriScoreBadge } from '../charts/NutriScoreBadge'


interface MealCardProps {
  mealType: MealType
  recipe?: Recipe
  members?: FamilyMember[]
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
  onPress,
  onSuggestAlternative,
  onLock,
  isLocked = false,
  isGenerating = false,
}: MealCardProps) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.9}
    >
      <View style={styles.header}>
        <Text style={styles.mealLabel}>{MEAL_EMOJIS[mealType]} {MEAL_LABELS[mealType]}</Text>
        <View style={styles.headerActions}>
          {onLock && (
            <TouchableOpacity onPress={onLock} style={styles.iconBtn}>
              <Text style={styles.iconBtnText}>{isLocked ? '🔒' : '🔓'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isGenerating ? (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Generando plan de comidas...</Text>
        </View>
      ) : recipe ? (
        <>
          <View style={styles.recipeRow}>
            {recipe.imageUrl && (
              <Image source={{ uri: recipe.imageUrl }} style={styles.recipeImage} />
            )}
            <View style={styles.recipeInfo}>
              <Text style={styles.recipeName} numberOfLines={2}>{recipe.name}</Text>
              <View style={styles.recipeMeta}>
                <Text style={styles.metaText}>⏱ {recipe.prepTime + recipe.cookTime}min</Text>
                <Text style={styles.metaText}>🔥 {recipe.nutritionalInfo.calories} kcal</Text>
              </View>
              {recipe.nutriscore && (
                <NutriScoreBadge score={recipe.nutriscore} size="sm" />
              )}
            </View>
          </View>

          <MacroBar nutritionalInfo={recipe.nutritionalInfo} height={6} showLabels />

          {members.length > 0 && recipe.familyCompatibility && (
            <View style={styles.compat}>
              <FamilyCompatibilityRow
                compatibility={recipe.familyCompatibility}
                members={members}
                compact
              />
            </View>
          )}

          {onSuggestAlternative && !isLocked && (
            <TouchableOpacity style={styles.alternativeBtn} onPress={onSuggestAlternative}>
              <Text style={styles.alternativeBtnText}>↻ Sugerir alternativa</Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        <TouchableOpacity style={styles.emptySlot} onPress={onSuggestAlternative}>
          <Text style={styles.emptyText}>+ Añadir comida</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: BorderRadius.xl,
      padding: Spacing.md,
      gap: Spacing.md,
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
    headerActions: {
      flexDirection: 'row',
      gap: Spacing.xs,
    },
    iconBtn: {
      padding: Spacing.xs,
    },
    iconBtnText: {
      fontSize: 16,
    },
    recipeRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    recipeImage: {
      width: 72,
      height: 72,
      borderRadius: BorderRadius.md,
    },
    recipeInfo: {
      flex: 1,
      gap: Spacing.xs,
    },
    recipeName: {
      ...Typography.bodyLarge,
      color: colors.text,
      fontFamily: Typography.heading3.fontFamily,
    },
    recipeMeta: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    metaText: {
      ...Typography.caption,
      color: colors.textSecondary,
    },
    compat: {
      marginTop: Spacing.xs,
    },
    alternativeBtn: {
      alignSelf: 'flex-end',
      paddingVertical: Spacing.xs,
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
      padding: Spacing.md,
      alignItems: 'center',
    },
    loadingText: {
      ...Typography.body,
      color: colors.textSecondary,
    },
    emptySlot: {
      padding: Spacing.lg,
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
