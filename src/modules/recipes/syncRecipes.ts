import AsyncStorage from '@react-native-async-storage/async-storage'
import { searchMediterraneanRecipes, getRecipeDetail } from '../../services/fatsecret'
import {
  searchSpoonacularByCuisine,
  getSpoonacularRecipeDetail,
  SPOONACULAR_CUISINE_QUERIES,
} from '../../services/spoonacular'
import { batchUpsertRecipes, cleanDuplicateImageUrls, getRecipeCount, updateRecipeFullDetail } from './recipeDB'
import { markSourceSynced, RecipeSourceKey } from './recipeSourcesConfig'

// Bump whenever sync logic changes to force a re-download.
const SYNC_VERSION = '5'

const KEY_RECIPES_SYNCED   = 'recipes_synced'
const KEY_SYNC_VERSION     = 'recipes_sync_version'
const KEY_RECIPES_SYNC_DATE = 'recipes_sync_date'

const MIN_SYNCED_COUNT = 100

export type SyncProgressCallback = (progress: number, message: string) => void

export async function isSynced(): Promise<boolean> {
  const version = await AsyncStorage.getItem(KEY_SYNC_VERSION)
  if (version !== SYNC_VERSION) return false
  const synced = await AsyncStorage.getItem(KEY_RECIPES_SYNCED)
  if (synced !== 'true') return false
  const count = await getRecipeCount()
  return count >= MIN_SYNCED_COUNT
}

export async function markSynced(): Promise<void> {
  await AsyncStorage.setItem(KEY_RECIPES_SYNCED, 'true')
  await AsyncStorage.setItem(KEY_SYNC_VERSION, SYNC_VERSION)
  await AsyncStorage.setItem(KEY_RECIPES_SYNC_DATE, new Date().toISOString())
}

// ─── FatSecret sync ───────────────────────────────────────────────────────────

export async function syncFatSecretRecipes(
  onProgress?: SyncProgressCallback
): Promise<number> {
  onProgress?.(0, 'Conectando con FatSecret...')

  const recipes = await searchMediterraneanRecipes((msg) => {
    onProgress?.(0.5, msg)
  })

  onProgress?.(0.9, `Guardando ${recipes.length} recetas mediterráneas...`)
  await batchUpsertRecipes(recipes)

  onProgress?.(0.95, 'Filtrando imágenes incorrectas...')
  await cleanDuplicateImageUrls()

  await markSynced()
  await markSourceSynced('fatsecret', recipes.length)

  onProgress?.(1, `¡${recipes.length} recetas mediterráneas descargadas!`)
  return recipes.length
}

// Backward-compat alias used by older call sites
export const syncRecipes = syncFatSecretRecipes

// ─── Spoonacular sync ─────────────────────────────────────────────────────────

export async function syncSpoonacularRecipes(
  onProgress?: SyncProgressCallback
): Promise<number> {
  onProgress?.(0, 'Conectando con Spoonacular...')

  const seen = new Set<string>()
  const allRecipes = []
  const total = SPOONACULAR_CUISINE_QUERIES.length

  for (let i = 0; i < total; i++) {
    const { cuisine, flag } = SPOONACULAR_CUISINE_QUERIES[i]
    onProgress?.((i / total) * 0.9, `Buscando recetas ${cuisine}...`)

    try {
      const stubs = await searchSpoonacularByCuisine(cuisine, flag, 50)
      for (const r of stubs) {
        if (!seen.has(r.id)) {
          seen.add(r.id)
          allRecipes.push(r)
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // If we hit the daily limit, stop gracefully
      if (msg.includes('Límite diario')) {
        onProgress?.(0.95, 'Límite diario de Spoonacular alcanzado.')
        break
      }
      console.warn(`[Spoonacular] Search failed for "${cuisine}":`, e)
    }

    await new Promise((r) => setTimeout(r, 150))
  }

  onProgress?.(0.95, `Guardando ${allRecipes.length} recetas...`)
  await batchUpsertRecipes(allRecipes)

  onProgress?.(0.98, 'Filtrando imágenes incorrectas...')
  await cleanDuplicateImageUrls()

  await markSourceSynced('spoonacular', allRecipes.length)

  onProgress?.(1, `¡${allRecipes.length} recetas de Spoonacular descargadas!`)
  return allRecipes.length
}

// ─── Unified dispatcher ───────────────────────────────────────────────────────

export async function syncSource(
  key: RecipeSourceKey,
  onProgress?: SyncProgressCallback
): Promise<number> {
  switch (key) {
    case 'fatsecret':   return syncFatSecretRecipes(onProgress)
    case 'spoonacular': return syncSpoonacularRecipes(onProgress)
  }
}

// ─── FatSecret lazy-load ──────────────────────────────────────────────────────

const enrichInFlight = new Set<string>()

export async function enrichRecipeDetail(
  recipeId: string,
  sourceId: string
): Promise<boolean> {
  if (enrichInFlight.has(sourceId)) return false
  enrichInFlight.add(sourceId)
  try {
    const detail = await getRecipeDetail(sourceId)
    if (!detail) return false
    await updateRecipeFullDetail(recipeId, detail)
    return true
  } finally {
    enrichInFlight.delete(sourceId)
  }
}

// ─── Spoonacular lazy-load ────────────────────────────────────────────────────

const spEnrichInFlight = new Set<string>()

export async function enrichSpoonacularDetail(
  recipeId: string,
  sourceId: string
): Promise<boolean> {
  if (spEnrichInFlight.has(sourceId)) return false
  spEnrichInFlight.add(sourceId)
  try {
    const detail = await getSpoonacularRecipeDetail(sourceId)
    if (!detail) return false
    await updateRecipeFullDetail(recipeId, {
      prepTime: detail.prepTime,
      cookTime: detail.cookTime,
      servings: detail.servings,
      instructions: detail.instructions,
      ingredients: detail.ingredients,
      nutritionalInfo: detail.nutritionalInfo,
      allergens: detail.allergens,
    })
    return true
  } finally {
    spEnrichInFlight.delete(sourceId)
  }
}
