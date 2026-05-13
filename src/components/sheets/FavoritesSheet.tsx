import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../theme'
import { useTheme, ThemeColors } from '../../theme/ThemeContext'
import { Recipe } from '../../types/recipes'
import { FamilyMember } from '../../types/profiles'
import { useProfiles } from '../../modules/profiles/ProfilesContext'
import { getFavoriteRecipes, getRecipesByIds, toggleFavorite } from '../../modules/recipes/recipeDB'
import { logger } from '../../utils/logger'

let BottomSheet: any = null
let BottomSheetScrollView: any = null
try {
  const bs = require('@gorhom/bottom-sheet')
  BottomSheet = bs.default
  BottomSheetScrollView = bs.BottomSheetScrollView
} catch {
  logger.info('[FavoritesSheet] @gorhom/bottom-sheet no disponible')
}

export interface FavoritesSheetRef {
  present: () => void
  dismiss: () => void
}

interface Props {
  member: FamilyMember
  onAfterClose?: () => void
}

export const FavoritesSheet = forwardRef<FavoritesSheetRef, Props>(
  function FavoritesSheet({ member, onAfterClose }, ref) {
    const { colors } = useTheme()
    const { removeFavorite } = useProfiles()
    const styles = useMemo(() => makeStyles(colors), [colors])
    const sheetRef = useRef<any>(null)
    const [memberRecipes, setMemberRecipes] = useState<Recipe[]>([])
    const [familyRecipes, setFamilyRecipes] = useState<Recipe[]>([])
    const [loading, setLoading] = useState(true)

    useImperativeHandle(ref, () => ({
      present: () => sheetRef.current?.expand(),
      dismiss: () => sheetRef.current?.close(),
    }))

    const refresh = useCallback(async () => {
      setLoading(true)
      try {
        const [perMember, family] = await Promise.all([
          getRecipesByIds(member.favoriteRecipeIds),
          getFavoriteRecipes(50),
        ])
        setMemberRecipes(perMember)
        setFamilyRecipes(family)
      } catch (e) {
        logger.warn('[FavoritesSheet] failed to load favorites:', e)
      } finally {
        setLoading(false)
      }
    }, [member.favoriteRecipeIds])

    useEffect(() => {
      refresh()
    }, [refresh])

    const openRecipe = useCallback((id: string) => {
      sheetRef.current?.close()
      router.push(`/recipe/${id}`)
    }, [])

    const handleRemoveFromMember = useCallback(
      async (recipeId: string) => {
        await removeFavorite(member.id, recipeId)
        setMemberRecipes((prev) => prev.filter((r) => r.id !== recipeId))
      },
      [member.id, removeFavorite]
    )

    const handleToggleFamily = useCallback(async (recipeId: string) => {
      await toggleFavorite(recipeId)
      setFamilyRecipes((prev) => prev.filter((r) => r.id !== recipeId))
    }, [])

    if (!BottomSheet) return null

    return (
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={['75%']}
        enablePanDownToClose
        onClose={onAfterClose}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handle}
        enableDynamicSizing={false}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Ionicons name="heart" size={20} color={Colors.errorRed} />
            <Text style={styles.title}>Favoritos</Text>
          </View>

          <BottomSheetScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Per-member section */}
            <Text style={styles.sectionTitle}>Favoritos de {member.name}</Text>
            {loading ? (
              <Text style={styles.empty}>Cargando…</Text>
            ) : memberRecipes.length === 0 ? (
              <Text style={styles.empty}>
                Aún no hay favoritos para {member.name}. Pídeselo al asistente o márcalos desde una receta.
              </Text>
            ) : (
              memberRecipes.map((r) => (
                <FavoriteRow
                  key={`m-${r.id}`}
                  recipe={r}
                  onPress={() => openRecipe(r.id)}
                  onRemove={() => handleRemoveFromMember(r.id)}
                  styles={styles}
                />
              ))
            )}

            {/* Family-shared section */}
            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
              Favoritos de la familia
            </Text>
            {loading ? null : familyRecipes.length === 0 ? (
              <Text style={styles.empty}>
                Sin favoritos compartidos. Marca recetas con el corazón en la pantalla de receta.
              </Text>
            ) : (
              familyRecipes.map((r) => (
                <FavoriteRow
                  key={`f-${r.id}`}
                  recipe={r}
                  onPress={() => openRecipe(r.id)}
                  onRemove={() => handleToggleFamily(r.id)}
                  styles={styles}
                />
              ))
            )}

            <View style={{ height: Spacing.xl }} />
          </BottomSheetScrollView>
        </View>
      </BottomSheet>
    )
  }
)

function FavoriteRow({
  recipe,
  onPress,
  onRemove,
  styles,
}: {
  recipe: Recipe
  onPress: () => void
  onRemove: () => void
  styles: ReturnType<typeof makeStyles>
}) {
  return (
    <View style={styles.row}>
      <TouchableOpacity style={styles.rowMain} onPress={onPress} activeOpacity={0.85}>
        <View style={styles.rowImageWrap}>
          {recipe.imageUrl ? (
            <Image source={{ uri: recipe.imageUrl }} style={styles.rowImage} />
          ) : (
            <View style={[styles.rowImage, styles.rowImagePlaceholder]}>
              <Text style={styles.rowImageEmoji}>🍽️</Text>
            </View>
          )}
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>{recipe.name}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {recipe.prepTime + recipe.cookTime} min · {recipe.nutritionalInfo.calories} kcal
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity onPress={onRemove} style={styles.rowAction} hitSlop={8}>
        <Ionicons name="close" size={18} color="#9A9A9A" />
      </TouchableOpacity>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.background,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
    },
    handle: { backgroundColor: colors.border, width: 40 },
    container: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { ...Typography.heading2, color: colors.text },
    scrollContent: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
    sectionTitle: {
      ...Typography.heading3,
      color: colors.text,
      marginBottom: Spacing.sm,
    },
    sectionTitleSpaced: { marginTop: Spacing.lg },
    empty: {
      ...Typography.body,
      color: colors.textMuted,
      paddingVertical: Spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.sm,
      marginBottom: Spacing.sm,
      ...Shadows.subtle,
    },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    rowImageWrap: { width: 48, height: 48, borderRadius: BorderRadius.sm, overflow: 'hidden' },
    rowImage: { width: 48, height: 48 },
    rowImagePlaceholder: {
      backgroundColor: colors.warmSurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowImageEmoji: { fontSize: 24 },
    rowText: { flex: 1 },
    rowName: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily },
    rowMeta: { ...Typography.caption, color: colors.textSecondary, marginTop: 2 },
    rowAction: { padding: Spacing.xs },
  })
}
