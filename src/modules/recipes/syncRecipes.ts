import AsyncStorage from '@react-native-async-storage/async-storage'
import { searchMediterraneanRecipes, getRecipeDetail } from '../../services/fatsecret'
import { batchUpsertRecipes, getRecipeCount, updateRecipeFullDetail } from './recipeDB'

// Bump this string whenever the sync logic changes to force a re-download.
const SYNC_VERSION = '4'

const KEY_RECIPES_SYNCED = 'recipes_synced'
const KEY_SYNC_VERSION = 'recipes_sync_version'
const KEY_RECIPES_SYNC_DATE = 'recipes_sync_date'

// Minimum count to consider the DB "ready". Seed alone gives ~50, so anything
// below this means a full FatSecret sync hasn't completed yet.
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

/**
 * Downloads Mediterranean-first recipes from FatSecret and stores them in
 * the local SQLite DB. Recipe stubs (name, image, nutrition) are stored
 * immediately; full ingredients and instructions are lazy-loaded on first open.
 *
 * Target: ~500 unique Mediterranean recipes across 15 search queries.
 * Only ~15 API calls during sync — full detail is fetched on demand.
 */
export async function syncRecipes(
  onProgress?: SyncProgressCallback
): Promise<void> {
  onProgress?.(0, 'Conectando con FatSecret...')

  const recipes = await searchMediterraneanRecipes((msg) => {
    onProgress?.(0.5, msg)
  })

  onProgress?.(0.9, `Guardando ${recipes.length} recetas mediterráneas...`)
  await batchUpsertRecipes(recipes)

  await markSynced()
  onProgress?.(1, `¡${recipes.length} recetas mediterráneas descargadas!`)
}

/**
 * Fetches full recipe detail (ingredients + instructions) from FatSecret
 * for a stub recipe that has not yet been enriched. Persists the enriched
 * data to the local DB so subsequent opens are instant.
 *
 * Returns true if enrichment succeeded, false otherwise.
 */
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
