import AsyncStorage from '@react-native-async-storage/async-storage'
import { FamilyMember } from '../../types/profiles'
import { encrypt, isKeyReady, tryDecrypt } from '../../services/encryption'

const KEY_PROFILES = 'family_profiles'
const KEY_FAMILY_NAME = 'family_name'
const KEY_APP_INITIALIZED = 'app_initialized'

// Sentinel prefix that lets `loadProfiles` recognise already-encrypted fields
// during migration from older plaintext payloads. New writes always use this
// prefix; legacy reads fall through to plaintext when the prefix is missing.
const ENC_PREFIX = 'enc:v1:'

function maybeEncrypt(value: string | undefined): string | undefined {
  if (!value) return value
  if (!isKeyReady()) return value // ensureKey() not yet awaited — leave as-is
  if (value.startsWith(ENC_PREFIX)) return value
  return ENC_PREFIX + encrypt(value)
}

function maybeEncryptArray(values: string[] | undefined): string[] | undefined {
  if (!values) return values
  if (!isKeyReady()) return values
  return values.map((v) => (v.startsWith(ENC_PREFIX) ? v : ENC_PREFIX + encrypt(v)))
}

function maybeDecrypt(value: string | undefined): string | undefined {
  if (!value) return value
  if (!value.startsWith(ENC_PREFIX)) return value // legacy plaintext
  return tryDecrypt(value.slice(ENC_PREFIX.length))
}

function maybeDecryptArray(values: string[] | undefined): string[] | undefined {
  if (!values) return values
  return values.map((v) => (v.startsWith(ENC_PREFIX) ? tryDecrypt(v.slice(ENC_PREFIX.length)) : v))
}

// Defaults applied when reading older payloads that predate the new
// favoriteRecipeIds / documents / aboutMeNotes fields.
function withDefaults(member: any): FamilyMember {
  return {
    ...member,
    favoriteRecipeIds: Array.isArray(member.favoriteRecipeIds) ? member.favoriteRecipeIds : [],
    documents: Array.isArray(member.documents) ? member.documents : [],
    isSuperUser: Boolean(member.isSuperUser),
    aboutMeNotes: maybeDecrypt(member.aboutMeNotes),
    conditions: maybeDecryptArray(member.conditions) ?? [],
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
  // Sensitive fields are encrypted *before* JSON.stringify so the cipherbytes
  // are what lands in AsyncStorage. The key is in iOS Keychain / Android
  // Keystore, so even an unauthenticated backup of AsyncStorage cannot
  // recover medical conditions or About-me notes.
  const protectedProfiles = profiles.map((m) => ({
    ...m,
    aboutMeNotes: maybeEncrypt(m.aboutMeNotes),
    conditions: maybeEncryptArray(m.conditions),
  }))
  await AsyncStorage.setItem(KEY_PROFILES, JSON.stringify(protectedProfiles))
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
