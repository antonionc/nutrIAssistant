import AsyncStorage from '@react-native-async-storage/async-storage'
import { SEED_RECIPES } from '../../seed/recipes-seed'
import { batchUpsertRecipes, getRecipeCount } from './recipeDB'
import { markSynced } from './syncRecipes'
import { logger } from '../../utils/logger'

const KEY_SEEDS_LOADED = 'seed_recipes_loaded'

export async function seedRecipesIfNeeded(): Promise<void> {
  const alreadyLoaded = await AsyncStorage.getItem(KEY_SEEDS_LOADED)
  if (alreadyLoaded === 'true') return

  const count = await getRecipeCount()
  if (count > 0) {
    // DB already has recipes — mark as loaded and skip
    await AsyncStorage.setItem(KEY_SEEDS_LOADED, 'true')
    await markSynced()
    return
  }

  logger.info('[Seed] Cargando recetas de ejemplo en la base de datos...')
  await batchUpsertRecipes(SEED_RECIPES)
  await AsyncStorage.setItem(KEY_SEEDS_LOADED, 'true')
  await markSynced()
  logger.info(`[Seed] ${SEED_RECIPES.length} recetas cargadas.`)
}
