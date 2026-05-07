import React, { useEffect, useMemo, useState } from 'react'
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRecipeDB } from '../../src/modules/recipes/useRecipeDB'
import { Colors, Typography, Spacing, BorderRadius } from '../../src/theme'
import { useTheme, ThemeColors } from '../../src/theme/ThemeContext'
import { useTranslation } from '../../src/i18n'
import { SearchBar } from '../../src/components/inputs/SearchBar'
import { RecipeCard } from '../../src/components/cards/RecipeCard'
import { EmptyState } from '../../src/components/layout/EmptyState'
import { RecipeCategory } from '../../src/types/recipes'
import { HeaderProfileAvatar } from '../../src/components/layout/HeaderProfileAvatar'

const CUISINE_ENTRIES: { key: string; flag: string; i18nKey: keyof ReturnType<typeof useTranslation>['recipes']['cuisines'] }[] = [
  { key: 'All',        flag: '🌍', i18nKey: 'all' },
  { key: 'Spanish',    flag: '🇪🇸', i18nKey: 'spanish' },
  { key: 'French',     flag: '🇫🇷', i18nKey: 'french' },
  { key: 'Greek',      flag: '🇬🇷', i18nKey: 'greek' },
  { key: 'Italian',    flag: '🇮🇹', i18nKey: 'italian' },
  { key: 'Japanese',   flag: '🇯🇵', i18nKey: 'japanese' },
  { key: 'Chinese',    flag: '🇨🇳', i18nKey: 'chinese' },
  { key: 'Indian',     flag: '🇮🇳', i18nKey: 'indian' },
  { key: 'Thai',       flag: '🇹🇭', i18nKey: 'thai' },
  { key: 'Mexican',    flag: '🇲🇽', i18nKey: 'mexican' },
  { key: 'American',   flag: '🇺🇸', i18nKey: 'american' },
  { key: 'British',    flag: '🇬🇧', i18nKey: 'british' },
  { key: 'Moroccan',   flag: '🇲🇦', i18nKey: 'moroccan' },
  { key: 'Turkish',    flag: '🇹🇷', i18nKey: 'turkish' },
  { key: 'Vietnamese', flag: '🇻🇳', i18nKey: 'vietnamese' },
]

const CATEGORY_KEYS: (RecipeCategory | 'all')[] = ['all', 'breakfast', 'lunch', 'dinner']

export default function RecipesScreen() {
  const { recipes, isLoading, load, search, filterByCategory, filterByCuisine } = useRecipeDB()
  const { colors } = useTheme()
  const tr = useTranslation()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [query, setQuery] = useState('')
  const [selectedCuisine, setSelectedCuisine] = useState('All')
  const [selectedCategory, setSelectedCategory] = useState<RecipeCategory | 'all'>('all')

  const CUISINE_OPTIONS = CUISINE_ENTRIES.map((c) => ({ ...c, label: tr.recipes.cuisines[c.i18nKey] }))
  const CATEGORY_FILTERS = CATEGORY_KEYS.map((key) => ({
    key,
    label: key === 'all' ? tr.recipes.categories.all : tr.recipes.categories[key as keyof typeof tr.recipes.categories],
  }))

  useEffect(() => {
    load(40)
  }, [load])

  const handleSearch = (text: string) => {
    setQuery(text)
    if (text.trim().length > 1) {
      search(text)
    } else if (text.trim().length === 0) {
      applyFilters(selectedCuisine, selectedCategory)
    }
  }

  const applyFilters = (cuisine: string, category: RecipeCategory | 'all') => {
    if (cuisine !== 'All') {
      filterByCuisine(cuisine)
    } else if (category !== 'all') {
      filterByCategory(category)
    } else {
      load(40)
    }
  }

  const handleCuisineSelect = (cuisine: string) => {
    setSelectedCuisine(cuisine)
    setQuery('')
    applyFilters(cuisine, selectedCategory)
  }

  const handleCategorySelect = (cat: RecipeCategory | 'all') => {
    setSelectedCategory(cat)
    setQuery('')
    applyFilters(selectedCuisine, cat)
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{tr.recipes.title}</Text>
        <HeaderProfileAvatar />
      </View>

      {/* Buscador */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={query}
          onChangeText={handleSearch}
          placeholder={tr.recipes.search}
          onClear={() => handleSearch('')}
        />
      </View>

      {/* Filtros por categoría */}
      <View style={styles.filterRow}>
        {CATEGORY_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.pill, selectedCategory === f.key && styles.pillActive]}
            onPress={() => handleCategorySelect(f.key)}
          >
            <Text style={[styles.pillText, selectedCategory === f.key && styles.pillTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Cocinas del mundo */}
      <View style={styles.cuisineSection}>
        <Text style={styles.cuisineLabel}>{tr.recipes.worldCuisines}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cuisineStrip}>
          {CUISINE_OPTIONS.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={[styles.cuisineBtn, selectedCuisine === c.key && styles.cuisineBtnActive]}
              onPress={() => handleCuisineSelect(c.key)}
            >
              <Text style={styles.cuisineFlag}>{c.flag}</Text>
              <Text style={[styles.cuisineText, selectedCuisine === c.key && styles.cuisineTextActive]}>
                {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Cuadrícula de recetas */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>{tr.recipes.loading}</Text>
        </View>
      ) : recipes.length === 0 ? (
        <EmptyState
          emoji={tr.empty.recipes.emoji}
          title={tr.empty.recipes.title}
          description={tr.empty.recipes.desc}
          actionLabel={tr.empty.recipes.action}
          onAction={() => { setQuery(''); setSelectedCuisine('All'); setSelectedCategory('all'); load(40) }}
        />
      ) : (
        <FlatList
          data={recipes}
          keyExtractor={(r) => r.id}
          numColumns={2}
          style={styles.recipeList}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <RecipeCard
              recipe={item}
              onPress={() => router.push(`/recipe/${item.id}`)}
            />
          )}
          ListFooterComponent={<View style={{ height: 120 }} />}
        />
      )}
    </SafeAreaView>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.xs,
    },
    title: { ...Typography.displaySerif, color: colors.text },
    searchContainer: { paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
    filterRow: {
      flexDirection: 'row',
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      gap: Spacing.sm,
    },
    pill: {
      flex: 1,
      height: 56,
      borderRadius: BorderRadius.lg,
      backgroundColor: colors.mintSurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pillActive: { backgroundColor: Colors.healthGreen },
    pillText: { ...Typography.bodyLarge, color: colors.text, fontFamily: Typography.heading3.fontFamily },
    pillTextActive: { color: Colors.white },
    cuisineSection: { marginBottom: Spacing.sm },
    cuisineLabel: { ...Typography.overline, color: colors.textSecondary, paddingHorizontal: Spacing.md, marginBottom: Spacing.xs },
    cuisineStrip: { paddingHorizontal: Spacing.md, gap: Spacing.sm },
    cuisineBtn: {
      alignItems: 'center', paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
      borderRadius: BorderRadius.md, backgroundColor: colors.surface, minWidth: 60,
      borderWidth: 1, borderColor: colors.border,
    },
    cuisineBtnActive: { borderColor: Colors.healthGreen, backgroundColor: `${Colors.healthGreen}15` },
    cuisineFlag: { fontSize: 20 },
    cuisineText: { ...Typography.caption, color: colors.text },
    cuisineTextActive: { color: Colors.healthGreen, fontFamily: Typography.body.fontFamily },
    recipeList: { flex: 1 },
    grid: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
    gridRow: { gap: Spacing.sm, marginBottom: Spacing.sm },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { ...Typography.body, color: colors.textSecondary },
  })
}
