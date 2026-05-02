import AsyncStorage from '@react-native-async-storage/async-storage'
import { searchMediterraneanRecipes, getRecipeDetail } from '../../services/fatsecret'
import {
  searchAllSpoonacularByCuisine,
  getSpoonacularRecipeDetail,
  SPOONACULAR_CUISINE_QUERIES,
} from '../../services/spoonacular'
import { translateRecipeNames, translateInstructions } from '../../services/translator'
import {
  batchUpsertRecipes,
  cleanDuplicateImageUrls,
  getRecipeCount,
  updateRecipeFullDetail,
  updateRecipeTranslation,
} from './recipeDB'
import { markSourceSynced, RecipeSourceKey } from './recipeSourcesConfig'

// Bump whenever sync logic changes to force a re-download.
const SYNC_VERSION = '6'

const KEY_RECIPES_SYNCED    = 'recipes_synced'
const KEY_SYNC_VERSION      = 'recipes_sync_version'
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

  const recipes = await searchMediterraneanRecipes((msg) => { onProgress?.(0.5, msg) })

  onProgress?.(0.9, `Guardando ${recipes.length} recetas mediterráneas...`)
  await batchUpsertRecipes(recipes)

  onProgress?.(0.95, 'Filtrando imágenes incorrectas...')
  await cleanDuplicateImageUrls()

  await markSynced()
  await markSourceSynced('fatsecret', recipes.length)

  onProgress?.(1, `¡${recipes.length} recetas mediterráneas descargadas!`)
  return recipes.length
}

// Backward-compat alias
export const syncRecipes = syncFatSecretRecipes

// ─── Spoonacular sync ─────────────────────────────────────────────────────────

// Translate recipe names in batches of 50 and persist to DB.
// Runs in the background — caller should not await.
async function translateSpoonacularNames(
  recipes: { id: string; name: string }[]
): Promise<void> {
  const BATCH = 50
  for (let i = 0; i < recipes.length; i += BATCH) {
    const batch = recipes.slice(i, i + BATCH)
    try {
      const map = await translateRecipeNames(batch)
      for (const [id, nameEs] of map) {
        await updateRecipeTranslation(id, { nameEs })
      }
    } catch (e) {
      console.warn('[Translate] Batch failed:', e)
    }
    // Brief pause between Claude calls to avoid bursting
    await new Promise((r) => setTimeout(r, 100))
  }
  console.log(`[Translate] Finished translating ${recipes.length} Spoonacular recipe names`)
}

export async function syncSpoonacularRecipes(
  onProgress?: SyncProgressCallback
): Promise<number> {
  onProgress?.(0, 'Conectando con Spoonacular...')

  const seen  = new Set<string>()
  const total = SPOONACULAR_CUISINE_QUERIES.length
  let   totalCount = 0

  for (let i = 0; i < total; i++) {
    const { cuisine, flag } = SPOONACULAR_CUISINE_QUERIES[i]
    const baseProgress = (i / total) * 0.85

    onProgress?.(baseProgress, `Buscando recetas ${cuisine}...`)

    try {
      const stubs = await searchAllSpoonacularByCuisine(
        cuisine,
        flag,
        (fetched, max) => {
          const p = baseProgress + (fetched / Math.max(max, 1)) * (0.85 / total)
          onProgress?.(p, `${cuisine}: ${fetched}/${max}`)
        }
      )

      // Deduplicate across cuisines, then persist this batch immediately
      const fresh = stubs.filter((r) => !seen.has(r.id))
      for (const r of fresh) seen.add(r.id)
      if (fresh.length > 0) {
        await batchUpsertRecipes(fresh)
        totalCount += fresh.length
      }

      // Background-translate this cuisine's names right away so Spanish
      // names appear progressively as each cuisine finishes.
      if (fresh.length > 0) {
        translateSpoonacularNames(fresh.map((r) => ({ id: r.id, name: r.name }))).catch(
          (e) => console.warn('[Translate] Background translation error:', e)
        )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('Límite diario')) {
        onProgress?.(0.88, 'Límite diario de Spoonacular alcanzado.')
        break
      }
      console.warn(`[Spoonacular] Search failed for "${cuisine}":`, e)
    }
  }

  onProgress?.(0.95, 'Filtrando imágenes incorrectas...')
  await cleanDuplicateImageUrls()

  await markSourceSynced('spoonacular', totalCount)
  onProgress?.(1, `¡${totalCount} recetas descargadas! Traduciendo al español en segundo plano...`)
  return totalCount
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
      prepTime:       detail.prepTime,
      cookTime:       detail.cookTime,
      servings:       detail.servings,
      instructions:   detail.instructions,
      ingredients:    detail.ingredients,
      nutritionalInfo: detail.nutritionalInfo,
      allergens:      detail.allergens,
    })

    // Translate instructions lazily (fire-and-forget)
    if (detail.instructions.length > 0) {
      translateInstructions(detail.instructions)
        .then((es) => updateRecipeTranslation(recipeId, { instructionsEs: es }))
        .catch((e) => console.warn('[Translate] Instructions failed:', e))
    }

    return true
  } finally {
    spEnrichInFlight.delete(sourceId)
  }
}
