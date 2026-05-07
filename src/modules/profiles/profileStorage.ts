import AsyncStorage from '@react-native-async-storage/async-storage'
import { FamilyMember } from '../../types/profiles'

const KEY_PROFILES = 'family_profiles'
const KEY_FAMILY_NAME = 'family_name'
const KEY_APP_INITIALIZED = 'app_initialized'

// Defaults applied when reading older payloads that predate the new
// favoriteRecipeIds / documents fields.
function withDefaults(member: any): FamilyMember {
  return {
    ...member,
    favoriteRecipeIds: Array.isArray(member.favoriteRecipeIds) ? member.favoriteRecipeIds : [],
    documents: Array.isArray(member.documents) ? member.documents : [],
    isSuperUser: Boolean(member.isSuperUser),
  } as FamilyMember
}

export async function loadProfiles(): Promise<FamilyMember[]> {
  const json = await AsyncStorage.getItem(KEY_PROFILES)
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.map(withDefaults) : []
  } catch (e) {
    console.error('[profileStorage] Corrupt profiles data, resetting:', e)
    return []
  }
}

export async function saveProfiles(profiles: FamilyMember[]): Promise<void> {
  await AsyncStorage.setItem(KEY_PROFILES, JSON.stringify(profiles))
}

export async function loadFamilyName(): Promise<string> {
  return (await AsyncStorage.getItem(KEY_FAMILY_NAME)) ?? 'Your Family'
}

export async function saveFamilyName(name: string): Promise<void> {
  await AsyncStorage.setItem(KEY_FAMILY_NAME, name)
}

export async function isAppInitialized(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_APP_INITIALIZED)) === 'true'
}

export async function markAppInitialized(): Promise<void> {
  await AsyncStorage.setItem(KEY_APP_INITIALIZED, 'true')
}
