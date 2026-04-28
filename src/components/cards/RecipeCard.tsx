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

  if (compact) {
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
          <Text style={styles.compactMeta}>⏱ {totalTime}min · 🔥 {recipe.nutritionalInfo.calories} kcal</Text>
        </View>
        </View>
      </TouchableOpacity>
    )
  }

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

          <View style={styles.metaRow}>
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>⏱ {totalTime} min</Text>
            </View>
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>🔥 {recipe.nutritionalInfo.calories} kcal</Text>
            </View>
            {recipe.nutritionalInfo.protein > 0 && (
              <View style={[styles.metaChip, styles.metaChipGreen]}>
                <Text style={[styles.metaChipText, styles.metaChipTextGreen]}>
                  {recipe.nutritionalInfo.protein}g prot.
                </Text>
              </View>
            )}
          </View>

          {recipe.tags.length > 0 && (
            <Text style={styles.tags} numberOfLines={1}>
              {recipe.tags.slice(0, 3).join(' · ')}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    cardShadow: {
      borderRadius: BorderRadius.xl,
      ...Shadows.card,
      marginHorizontal: Spacing.md,
      marginBottom: Spacing.md,
    },
    card: {
      flexDirection: 'row',
      backgroundColor: colors.cardBackground,
      borderRadius: BorderRadius.xl,
      overflow: 'hidden',
    },
    imageWrapper: {
      position: 'relative',
      width: 120,
      height: 120,
    },
    image: {
      width: 120,
      height: 120,
      resizeMode: 'cover',
    },
    imagePlaceholder: {
      backgroundColor: colors.mintSurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    placeholderEmoji: {
      fontSize: 36,
    },
    nutriscoreOverlay: {
      position: 'absolute',
      bottom: Spacing.xs,
      left: Spacing.xs,
    },
    content: {
      flex: 1,
      padding: Spacing.md,
      justifyContent: 'center',
      gap: Spacing.xs,
    },
    cuisineTag: {
      ...Typography.caption,
      color: colors.textSecondary,
    },
    name: {
      ...Typography.heading3,
      color: colors.text,
      lineHeight: 20,
    },
    metaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
      marginTop: Spacing.xs,
    },
    metaChip: {
      backgroundColor: colors.mintSurface,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 3,
      borderRadius: BorderRadius.pill,
    },
    metaChipGreen: {
      backgroundColor: `${Colors.healthGreen}18`,
    },
    metaChipText: {
      ...Typography.caption,
      color: colors.text,
    },
    metaChipTextGreen: {
      color: Colors.healthGreen,
    },
    tags: {
      ...Typography.caption,
      color: colors.textMuted,
      marginTop: 2,
    },

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
