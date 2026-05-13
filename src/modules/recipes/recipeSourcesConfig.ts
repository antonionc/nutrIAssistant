import AsyncStorage from '@react-native-async-storage/async-storage'

export type RecipeSourceKey = 'edamam' | 'spoonacular' | 'themealdb'

export interface RecipeSourceInfo {
  enabled: boolean
  lastSyncedAt: string | null
  syncedCount: number
}

export const SOURCE_LABELS: Record<RecipeSourceKey, { name: string; description: string; emoji: string }> = {
  edamam:      { name: 'Edamam',       description: 'Recetas mediterráneas y europeas',      emoji: '🥗' },
  spoonacular: { name: 'Spoonacular',  description: 'Base de datos mundial de recetas',       emoji: '🌍' },
  themealdb:   { name: 'TheMealDB',    description: 'Recetas internacionales con imágenes',   emoji: '🍽️' },
}

export const DEFAULT_SOURCES_CONFIG: Record<RecipeSourceKey, RecipeSourceInfo> = {
  edamam:      { enabled: true,  lastSyncedAt: null, syncedCount: 0 },
  spoonacular: { enabled: false, lastSyncedAt: null, syncedCount: 0 },
  themealdb:   { enabled: true,  lastSyncedAt: null, syncedCount: 0 },
}

const SOURCES_CONFIG_KEY = 'recipe_sources_config'

interface LegacyStoredConfig {
  fatsecret?: Partial<RecipeSourceInfo>
  edamam?: Partial<RecipeSourceInfo>
  spoonacular?: Partial<RecipeSourceInfo>
  themealdb?: Partial<RecipeSourceInfo>
}

export async function getSourcesConfig(): Promise<Record<RecipeSourceKey, RecipeSourceInfo>> {
  const raw = await AsyncStorage.getItem(SOURCES_CONFIG_KEY)
  if (!raw) return { ...DEFAULT_SOURCES_CONFIG }
  const stored = JSON.parse(raw) as LegacyStoredConfig
  // Migrate legacy `fatsecret` slot to `edamam` so existing installs keep
  // the user's enabled/syncedAt state across the source swap.
  const edamamStored = stored.edamam ?? stored.fatsecret
  return {
    edamam:      { ...DEFAULT_SOURCES_CONFIG.edamam,      ...(edamamStored      ?? {}) },
    spoonacular: { ...DEFAULT_SOURCES_CONFIG.spoonacular, ...(stored.spoonacular ?? {}) },
    themealdb:   { ...DEFAULT_SOURCES_CONFIG.themealdb,   ...(stored.themealdb   ?? {}) },
  }
}

export async function setSourceEnabled(key: RecipeSourceKey, enabled: boolean): Promise<void> {
  const config = await getSourcesConfig()
  config[key] = { ...config[key], enabled }
  await AsyncStorage.setItem(SOURCES_CONFIG_KEY, JSON.stringify(config))
}

export async function markSourceSynced(key: RecipeSourceKey, count: number): Promise<void> {
  const config = await getSourcesConfig()
  config[key] = { ...config[key], lastSyncedAt: new Date().toISOString(), syncedCount: count }
  await AsyncStorage.setItem(SOURCES_CONFIG_KEY, JSON.stringify(config))
}
