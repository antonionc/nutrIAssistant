import { useCallback, useEffect, useState } from 'react'
import { Recipe } from '../../types/recipes'
import {
  getAllRecipes,
  getRecipeById,
  getRecipesByCategory,
  getRecipesByCuisine,
  getRandomRecipes,
  searchRecipes,
  toggleFavorite,
  getRecipeCount,
} from './recipeDB'
import { useProfiles } from '../profiles/ProfilesContext'
import { checkFamilyCompatibility } from '../profiles/allergenEngine'
import { enrichRecipeDetail, enrichSpoonacularDetail } from './syncRecipes'

export function useRecipeDB() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const { profiles } = useProfiles()

  useEffect(() => {
    getRecipeCount().then(setTotalCount)
  }, [])

  const enrichWithCompatibility = useCallback(
    (recipes: Recipe[]): Recipe[] => {
      if (profiles.length === 0) return recipes
      return recipes.map((r) => ({
        ...r,
        familyCompatibility: checkFamilyCompatibility(r, profiles),
      }))
    },
    [profiles]
  )

  const load = useCallback(
    async (limit = 20, offset = 0) => {
      setIsLoading(true)
      const results = await getAllRecipes(limit, offset)
      setRecipes(enrichWithCompatibility(results))
      setIsLoading(false)
    },
    [enrichWithCompatibility]
  )

  const search = useCallback(
    async (query: string) => {
      setIsLoading(true)
      const results = await searchRecipes(query)
      setRecipes(enrichWithCompatibility(results))
      setIsLoading(false)
    },
    [enrichWithCompatibility]
  )

  const filterByCategory = useCallback(
    async (category: string) => {
      setIsLoading(true)
      const results = await getRecipesByCategory(category)
      setRecipes(enrichWithCompatibility(results))
      setIsLoading(false)
    },
    [enrichWithCompatibility]
  )

  const filterByCuisine = useCallback(
    async (cuisine: string) => {
      setIsLoading(true)
      const results = await getRecipesByCuisine(cuisine)
      setRecipes(enrichWithCompatibility(results))
      setIsLoading(false)
    },
    [enrichWithCompatibility]
  )

  const getById = useCallback(
    async (id: string): Promise<Recipe | null> => {
      let recipe = await getRecipeById(id)
      if (!recipe) return null

      // Lazy-load full detail for stub recipes (first open only)
      if (recipe.instructions.length === 0 && recipe.sourceId) {
        let ok = false
        if (recipe.sourceApi === 'edamam') {
          ok = await enrichRecipeDetail(recipe.id, recipe.sourceId)
        } else if (recipe.sourceApi === 'spoonacular') {
          ok = await enrichSpoonacularDetail(recipe.id, recipe.sourceId)
        }
        if (ok) recipe = (await getRecipeById(id)) ?? recipe
      }

      return {
        ...recipe,
        familyCompatibility: checkFamilyCompatibility(recipe, profiles),
      }
    },
    [profiles]
  )

  const getRandom = useCallback(
    async (limit = 6, category?: string): Promise<Recipe[]> => {
      const results = await getRandomRecipes(limit, category)
      return enrichWithCompatibility(results)
    },
    [enrichWithCompatibility]
  )

  const favorite = useCallback(async (id: string) => {
    await toggleFavorite(id)
    setRecipes((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isFavorite: !r.isFavorite } : r))
    )
  }, [])

  return {
    recipes,
    isLoading,
    totalCount,
    load,
    search,
    filterByCategory,
    filterByCuisine,
    getById,
    getRandom,
    favorite,
  }
}
