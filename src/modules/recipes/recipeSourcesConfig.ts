import AsyncStorage from '@react-native-async-storage/async-storage'

export type RecipeSourceKey = 'fatsecret' | 'spoonacular'

export interface RecipeSourceInfo {
  enabled: boolean
  lastSyncedAt: string | null
  syncedCount: number
}

export const SOURCE_LABELS: Record<RecipeSourceKey, { name: string; description: string; emoji: string }> = {
  fatsecret:   { name: 'FatSecret',    description: 'Recetas mediterráneas y europeas',  emoji: '🥗' },
  spoonacular: { name: 'Spoonacular',  description: 'Base de datos mundial de recetas',   emoji: '🌍' },
}

export const DEFAULT_SOURCES_CONFIG: Record<RecipeSourceKey, RecipeSourceInfo> = {
  fatsecret:   { enabled: true,  lastSyncedAt: null, syncedCount: 0 },
  spoonacular: { enabled: false, lastSyncedAt: null, syncedCount: 0 },
}

const SOURCES_CONFIG_KEY = 'recipe_sources_config'

export async function getSourcesConfig(): Promise<Record<RecipeSourceKey, RecipeSourceInfo>> {
  const raw = await AsyncStorage.getItem(SOURCES_CONFIG_KEY)
  if (!raw) return { ...DEFAULT_SOURCES_CONFIG }
  const stored = JSON.parse(raw) as Partial<Record<RecipeSourceKey, RecipeSourceInfo>>
  return {
    fatsecret:   { ...DEFAULT_SOURCES_CONFIG.fatsecret,   ...(stored.fatsecret   ?? {}) },
    spoonacular: { ...DEFAULT_SOURCES_CONFIG.spoonacular, ...(stored.spoonacular ?? {}) },
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
