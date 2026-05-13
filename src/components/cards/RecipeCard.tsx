import React, { useMemo } from 'react'
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Recipe } from '../../types/recipes'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../theme'

// "Powered by Edamam" is the exact phrasing required by Edamam's free-tier
// TOS for attribution on any screen that displays their recipe data.
// Other sources are labelled with their plain name.
const SOURCE_LABEL: Partial<Record<string, string>> = {
  edamam:       'Powered by Edamam',
  spoonacular:  'Spoonacular',
  themealdb:    'TheMealDB',
  ai_generated: '✨ AI',
}
import { useTheme, ThemeColors } from '../../theme/ThemeContext'
import { NutriScoreBadge } from '../charts/NutriScoreBadge'

interface RecipeCardProps {
  recipe: Recipe
  onPress?: () => void
  compact?: boolean
}

export function RecipeCard({ recipe, onPress, compact = false }: RecipeCardProps) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const totalTime = recipe.prepTime + recipe.cookTime
  const dietTag = recipe.tags[0] ?? null

  if (compact) {
    // Horizontal carousel card — 160px wide thumbnail
    return (
      <TouchableOpacity style={styles.compactCardShadow} onPress={onPress} activeOpacity={0.8}>
        <View style={styles.compactCard}>
          <View style={styles.compactImageWrapper}>
            {recipe.imageUrl ? (
              <Image source={{ uri: recipe.imageUrl }} style={styles.compactImage} />
            ) : (
              <View style={[styles.compactImage, styles.imagePlaceholder]}>
                <Text style={styles.placeholderEmoji}>🍽️</Text>
              </View>
            )}
            {recipe.nutriscore && (
              <View style={styles.compactNutriscore}>
                <NutriScoreBadge score={recipe.nutriscore} size="sm" />
              </View>
            )}
          </View>
          <View style={styles.compactContent}>
            <Text style={styles.compactName} numberOfLines={2}>{recipe.name}</Text>
            <Text style={styles.compactMeta}>{totalTime} min · {recipe.nutritionalInfo.calories} kcal</Text>
          </View>
        </View>
      </TouchableOpacity>
    )
  }

  // Default: vertical card with full-bleed image, for 2-column grid
  return (
    <TouchableOpacity style={styles.cardShadow} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.card}>
        <View style={styles.imageWrapper}>
          {recipe.imageUrl ? (
            <Image source={{ uri: recipe.imageUrl }} style={styles.image} />
          ) : (
            <View style={[styles.image, styles.imagePlaceholder]}>
              <Text style={styles.placeholderEmoji}>🍽️</Text>
            </View>
          )}
          {/* Dietary tag badge — top left overlay */}
          {dietTag && (
            <View style={styles.dietBadge}>
              <Text style={styles.dietBadgeText} numberOfLines={1}>{dietTag}</Text>
            </View>
          )}
          {/* Nutriscore — top right overlay */}
          {recipe.nutriscore && (
            <View style={styles.nutriscoreOverlay}>
              <NutriScoreBadge score={recipe.nutriscore} size="sm" />
            </View>
          )}
        </View>

        <View style={styles.content}>
          {recipe.cuisineFlag ? (
            <Text style={styles.cuisineTag}>{recipe.cuisineFlag} {recipe.cuisine}</Text>
          ) : null}
          <Text style={styles.name} numberOfLines={2}>{recipe.name}</Text>
          <Text style={styles.meta}>{totalTime} min · {recipe.nutritionalInfo.calories} kcal</Text>
          {SOURCE_LABEL[recipe.sourceApi ?? ''] && (
            <Text style={styles.sourceLabel}>{SOURCE_LABEL[recipe.sourceApi ?? '']}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    // ── Default vertical card ────────────────────────────────────────────────
    cardShadow: {
      borderRadius: BorderRadius.lg,
      ...Shadows.card,
      flex: 1,
    },
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: BorderRadius.lg,
      overflow: 'hidden',
    },
    imageWrapper: {
      position: 'relative',
      width: '100%',
      aspectRatio: 4 / 3,
    },
    image: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    imagePlaceholder: {
      backgroundColor: colors.warmSurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    placeholderEmoji: {
      fontSize: 36,
    },
    dietBadge: {
      position: 'absolute',
      top: Spacing.xs,
      left: Spacing.xs,
      backgroundColor: 'rgba(245,243,238,0.92)',
      paddingHorizontal: Spacing.sm,
      paddingVertical: 4,
      borderRadius: BorderRadius.pill,
      maxWidth: '70%',
    },
    dietBadgeText: {
      fontSize: 11,
      fontFamily: Typography.overline.fontFamily,
      color: Colors.warmCharcoal,
      letterSpacing: 0.2,
    },
    nutriscoreOverlay: {
      position: 'absolute',
      top: Spacing.xs,
      right: Spacing.xs,
    },
    content: {
      padding: Spacing.sm,
      gap: 3,
    },
    cuisineTag: {
      ...Typography.caption,
      color: colors.textSecondary,
    },
    name: {
      fontFamily: Typography.heading3.fontFamily,
      fontSize: 14,
      lineHeight: 19,
      color: colors.text,
    },
    meta: {
      ...Typography.caption,
      color: colors.textSecondary,
      marginTop: 2,
    },
    sourceLabel: {
      fontSize: 10,
      color: colors.textMuted,
      letterSpacing: 0.2,
      marginTop: 1,
    },

    // ── Compact carousel card (160px wide) ───────────────────────────────────
    compactCardShadow: {
      width: 160,
      borderRadius: BorderRadius.lg,
      ...Shadows.card,
    },
    compactCard: {
      borderRadius: BorderRadius.lg,
      overflow: 'hidden',
      backgroundColor: colors.cardBackground,
    },
    compactImageWrapper: {
      position: 'relative',
    },
    compactImage: {
      width: 160,
      height: 110,
      resizeMode: 'cover',
    },
    compactNutriscore: {
      position: 'absolute',
      top: Spacing.xs,
      right: Spacing.xs,
    },
    compactContent: {
      padding: Spacing.sm,
      gap: Spacing.xs,
    },
    compactName: {
      ...Typography.body,
      color: colors.text,
      fontFamily: Typography.heading3.fontFamily,
      lineHeight: 18,
    },
    compactMeta: {
      ...Typography.caption,
      color: colors.textSecondary,
    },
  })
}
