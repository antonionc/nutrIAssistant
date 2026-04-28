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
import { SearchBar } from '../../src/components/inputs/SearchBar'
import { RecipeCard } from '../../src/components/cards/RecipeCard'
import { EmptyState } from '../../src/components/layout/EmptyState'
import { RecipeCategory } from '../../src/types/recipes'

const CUISINE_OPTIONS = [
  { key: 'All', flag: '🌍', label: 'Todas' },
  { key: 'Spanish', flag: '🇪🇸', label: 'Española' },
  { key: 'French', flag: '🇫🇷', label: 'Francesa' },
  { key: 'Greek', flag: '🇬🇷', label: 'Griega' },
  { key: 'Italian', flag: '🇮🇹', label: 'Italiana' },
  { key: 'Japanese', flag: '🇯🇵', label: 'Japonesa' },
  { key: 'Chinese', flag: '🇨🇳', label: 'China' },
  { key: 'Indian', flag: '🇮🇳', label: 'India' },
  { key: 'Thai', flag: '🇹🇭', label: 'Tailandesa' },
  { key: 'Mexican', flag: '🇲🇽', label: 'Mexicana' },
  { key: 'American', flag: '🇺🇸', label: 'Americana' },
  { key: 'British', flag: '🇬🇧', label: 'Británica' },
  { key: 'Moroccan', flag: '🇲🇦', label: 'Marroquí' },
  { key: 'Turkish', flag: '🇹🇷', label: 'Turca' },
  { key: 'Vietnamese', flag: '🇻🇳', label: 'Vietnamita' },
]

const CATEGORY_FILTERS: { key: RecipeCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'breakfast', label: 'Desayuno' },
  { key: 'lunch', label: 'Comida' },
  { key: 'dinner', label: 'Cena' },
]

export default function RecipesScreen() {
  const { recipes, isLoading, load, search, filterByCategory, filterByCuisine } = useRecipeDB()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [query, setQuery] = useState('')
  const [selectedCuisine, setSelectedCuisine] = useState('All')
  const [selectedCategory, setSelectedCategory] = useState<RecipeCategory | 'all'>('all')

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
        <Text style={styles.title}>Recetas</Text>
      </View>

      {/* Buscador */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={query}
          onChangeText={handleSearch}
          placeholder="Buscar recetas, ingredientes..."
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
        <Text style={styles.cuisineLabel}>Cocinas del mundo</Text>
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
          <Text style={styles.loadingText}>Cargando recetas...</Text>
        </View>
      ) : recipes.length === 0 ? (
        <EmptyState
          emoji="🍽️"
          title="Sin recetas"
          description="Prueba un filtro diferente o una búsqueda distinta."
          actionLabel="Mostrar todas"
          onAction={() => { setQuery(''); setSelectedCuisine('All'); setSelectedCategory('all'); load(40) }}
        />
      ) : (
        <FlatList
          data={recipes}
          keyExtractor={(r) => r.id}
          style={styles.recipeList}
          contentContainerStyle={styles.grid}
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
    header: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
    title: { ...Typography.heading1, color: colors.text },
    searchContainer: { paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
    filterRow: {
      flexDirection: 'row',
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      gap: Spacing.sm,
    },
    pill: {
      flex: 1,
      paddingVertical: Spacing.xs,
      borderRadius: BorderRadius.pill,
      backgroundColor: colors.mintSurface,
      alignItems: 'center',
    },
    pillActive: { backgroundColor: Colors.healthGreen },
    pillText: { ...Typography.body, color: colors.text },
    pillTextActive: { color: Colors.white, fontFamily: Typography.heading3.fontFamily },
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
    grid: { paddingTop: Spacing.md },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { ...Typography.body, color: colors.textSecondary },
  })
}
