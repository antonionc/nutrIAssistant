import AsyncStorage from '@react-native-async-storage/async-storage'
import { FamilyMember } from '../../types/profiles'
import { encrypt, isKeyReady, tryDecrypt } from '../../services/encryption'
import { logger } from '../../utils/logger'
import { getDatabase } from '../../db/database'

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

// Used for primitive (number / string) GDPR Art. 9 fields. Numbers are
// stringified on write and parsed back on read. The on-disk type is always
// `string` (ciphertext); the in-memory type follows the FamilyMember shape.
function maybeEncryptScalar(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined
  if (!isKeyReady()) return String(value)
  const s = String(value)
  if (s.startsWith(ENC_PREFIX)) return s
  return ENC_PREFIX + encrypt(s)
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

function maybeDecryptNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number') return raw // legacy plaintext number
  if (typeof raw !== 'string' || !raw) return undefined
  const plain = raw.startsWith(ENC_PREFIX) ? tryDecrypt(raw.slice(ENC_PREFIX.length)) : raw
  const n = Number(plain)
  return Number.isNaN(n) ? undefined : n
}

function maybeDecryptString(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  return raw.startsWith(ENC_PREFIX) ? tryDecrypt(raw.slice(ENC_PREFIX.length)) : raw
}

// Defaults applied when reading older payloads that predate later field
// additions (`favoriteRecipeIds`, `documents`, `aboutMeNotes`) and to
// decrypt the GDPR Art. 9 fields (`weight`, `height`, `dateOfBirth`,
// `allergies`, `conditions`, `aboutMeNotes`). Pre-encryption installs
// store these as plaintext; `tryDecrypt` falls through transparently so
// no SQL migration is needed.
function withDefaults(member: any): FamilyMember {
  return {
    ...member,
    favoriteRecipeIds: Array.isArray(member.favoriteRecipeIds) ? member.favoriteRecipeIds : [],
    documents: Array.isArray(member.documents) ? member.documents : [],
    isSuperUser: Boolean(member.isSuperUser),
    weight: maybeDecryptNumber(member.weight) ?? 0,
    height: maybeDecryptNumber(member.height) ?? 0,
    dateOfBirth: maybeDecryptString(member.dateOfBirth) ?? '',
    allergies: (maybeDecryptArray(member.allergies) ?? []) as FamilyMember['allergies'],
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
    logger.error('[profileStorage] Corrupt profiles data, resetting:', e)
    return []
  }
}

/**
 * Mirrors the set of member IDs from AsyncStorage into the SQLite
 * `member_index` table created by migration 015. Adds new IDs, removes
 * deleted ones — keeps the index in sync so the ON DELETE CASCADE on
 * `member_memories`, `doc_chunks`, and `conversation_summaries`
 * actually does work when a member is removed.
 *
 * Best-effort: if SQLite is unavailable for any reason, profile writes
 * still succeed and the next boot retries.
 */
async function syncMemberIndex(profiles: FamilyMember[]): Promise<void> {
  try {
    const db = await getDatabase()
    const wanted = new Set(profiles.map((p) => p.id))
    const existing = await db.getAllAsync<{ id: string }>(
      'SELECT id FROM member_index',
    )
    const existingSet = new Set(existing.map((r) => r.id))

    // Insert new members.
    for (const id of wanted) {
      if (!existingSet.has(id)) {
        await db.runAsync('INSERT OR IGNORE INTO member_index (id) VALUES (?)', [id])
      }
    }
    // Delete members no longer in the profile list. Cascading FKs wipe
    // dependent rows automatically.
    for (const id of existingSet) {
      if (!wanted.has(id)) {
        await db.runAsync('DELETE FROM member_index WHERE id = ?', [id])
      }
    }
  } catch (err) {
    logger.warn('[profileStorage] syncMemberIndex failed (non-fatal)', { err })
  }
}

export async function saveProfiles(profiles: FamilyMember[]): Promise<void> {
  // Sensitive fields are encrypted *before* JSON.stringify so the cipherbytes
  // are what lands in AsyncStorage. The key is in iOS Keychain / Android
  // Keystore, so even an unauthenticated backup of AsyncStorage cannot
  // recover medical conditions, weight/height history, DOB, or allergies.
  // Note: `name`, `role`, `avatarUrl`, `dietPreference` stay in plaintext
  // because they are needed for cheap profile-picker rendering before the
  // key is unlocked; `aboutMeNotes`, `conditions`, `weight`, `height`,
  // `dateOfBirth`, `allergies` are Art. 9-strict and require ciphertext.
  const protectedProfiles = profiles.map((m) => ({
    ...m,
    weight: maybeEncryptScalar(m.weight),
    height: maybeEncryptScalar(m.height),
    dateOfBirth: maybeEncryptScalar(m.dateOfBirth),
    allergies: maybeEncryptArray(m.allergies as unknown as string[]),
    aboutMeNotes: maybeEncrypt(m.aboutMeNotes),
    conditions: maybeEncryptArray(m.conditions),
  }))
  await AsyncStorage.setItem(KEY_PROFILES, JSON.stringify(protectedProfiles))
  // Sync the SQLite member_index so cascading FKs trigger on deletes.
  await syncMemberIndex(profiles)
}

/**
 * Re-serialises every profile through saveProfiles(). Idempotent. Called
 * once at boot after `ensureKey()` so that legacy plaintext installs are
 * silently upgraded to the encrypted-fields layout. Safe to call multiple
 * times — the maybeEncrypt* helpers detect the `enc:v1:` sentinel and
 * skip re-encryption.
 */
export async function migrateProfilesToEncryptedFields(): Promise<void> {
  const profiles = await loadProfiles()
  if (profiles.length === 0) return
  await saveProfiles(profiles)
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
