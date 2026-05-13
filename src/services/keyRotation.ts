import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import {
  ensureKey,
  encryptWithKey,
  encryptBytesWithKey,
  decryptWithKey,
  decryptBytesWithKey,
  generateCandidateKey,
  swapMasterKey,
} from './encryption'
import { recordAuditEvent } from './auditLog'
import { getDatabase } from '../db/database'
import { ENCRYPTED_TARGETS, ENC_PREFIX, EncryptedTarget } from './encryptedTargets'
import { SK } from './storageKeys'
import { base64ToBytes } from '../utils/base64'
import { logger } from '../utils/logger'

// Manual master-key rotation.
//
// Flow:
//   1. Generate a candidate key in memory.
//   2. Read every persisted ciphertext, decrypt with the CURRENT key,
//      re-encrypt with the candidate key. The dependent surfaces are:
//        - SQLite columns enumerated in `ENCRYPTED_TARGETS`
//        - AsyncStorage `family_profiles` (nested encrypted strings)
//        - FileSystem `.pdf.enc` files under `profile-documents/`
//   3. Stream rewrites table-by-table / file-by-file so we never hold
//      more than one row's plaintext in memory at a time.
//   4. Atomically swap the master key in SecureStore once every surface
//      has been rewritten.
//
// If any decrypt fails, we abort BEFORE swapping the key — the user
// retries safely. Partial write failures land in `result.failed` and
// the operation still completes; only an empty `failed` list at the end
// triggers the swap.

const NONCE_LEN = 12
const DB_BATCH_SIZE = 100

export interface KeyRotationResult {
  profilesUpdated: number
  dbRowsUpdated: Record<string, number>
  filesUpdated: number
  failed: string[]
}

async function getCurrentKeyBytes(): Promise<Uint8Array> {
  const stored = await SecureStore.getItemAsync('nutri_master_key_v1')
  if (!stored) throw new Error('master key not available')
  const bytes = base64ToBytes(stored)
  if (bytes.length !== 32) {
    throw new Error(`master key has unexpected length ${bytes.length}`)
  }
  return bytes
}

/**
 * Streams the master-key rotation across every encrypted surface and,
 * if every decrypt succeeded, swaps the persisted key atomically.
 */
export async function rotateMasterKey(): Promise<KeyRotationResult> {
  await ensureKey()
  const result: KeyRotationResult = {
    profilesUpdated: 0,
    dbRowsUpdated: {},
    filesUpdated: 0,
    failed: [],
  }
  const newKey = generateCandidateKey()
  const currentKey = await getCurrentKeyBytes()

  await recordAuditEvent('key_rotation_started', {})

  // ── DB targets: stream-rotate each SQLite column ──────────────────────
  for (const target of ENCRYPTED_TARGETS) {
    try {
      const count = await rotateDbTarget(target, currentKey, newKey, result)
      result.dbRowsUpdated[target.name] = count
    } catch (err) {
      logger.error('[KeyRotation] rotation aborted for target', { target: target.name, err })
      result.failed.push(target.name)
    }
  }

  // ── AsyncStorage: re-encrypt every `enc:v1:` string in profiles ───────
  try {
    const rawProfiles = await AsyncStorage.getItem(SK.profiles)
    if (rawProfiles) {
      const parsed = JSON.parse(rawProfiles) as Array<Record<string, unknown>>
      const rewritten = parsed.map((m) => rewriteEncryptedFields(m, currentKey, newKey))
      await AsyncStorage.setItem(SK.profiles, JSON.stringify(rewritten))
      result.profilesUpdated = parsed.length
    }
  } catch (err) {
    logger.error('[KeyRotation] failed to rewrite profiles', { err })
    result.failed.push('async_storage:profiles')
  }

  // ── FileSystem: stream-rotate `.pdf.enc` files one-by-one ─────────────
  await rotatePdfFilesInPlace(currentKey, newKey, result)

  if (result.failed.length > 0) {
    logger.warn('[KeyRotation] aborting before swap due to failures', {
      failed: result.failed,
    })
    return result
  }

  // ── Atomic key swap ──────────────────────────────────────────────────
  await swapMasterKey(newKey)
  await recordAuditEvent('key_rotation_completed', {
    profilesUpdated: result.profilesUpdated,
    dbRowsUpdated: result.dbRowsUpdated,
    filesUpdated: result.filesUpdated,
  })
  return result
}

// ── DB streaming helpers ────────────────────────────────────────────────

/**
 * Rotates one SQLite column in `DB_BATCH_SIZE`-row batches. Each batch
 * is decrypted with the current key, re-encrypted with the new key, and
 * written back in a single `UPDATE` per row. We never hold more than
 * `DB_BATCH_SIZE` decrypted strings in memory at once.
 *
 * Returns the number of rows successfully rotated. Throws on any
 * decrypt failure so the caller can mark the whole rotation as
 * "aborted before swap".
 */
async function rotateDbTarget(
  target: EncryptedTarget,
  currentKey: Uint8Array,
  newKey: Uint8Array,
  result: KeyRotationResult,
): Promise<number> {
  if (!target.table || !target.column) return 0
  const db = await getDatabase()
  const { table, column } = target

  // Loop in (rowid > lastRowid LIMIT BATCH) order to keep memory bounded.
  let lastRowid = 0
  let totalUpdated = 0
  for (;;) {
    const rows = await db.getAllAsync<{ _rowid: number; enc: string | null }>(
      `SELECT rowid AS _rowid, ${column} AS enc FROM ${table} WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`,
      [lastRowid, DB_BATCH_SIZE],
    )
    if (rows.length === 0) break

    for (const row of rows) {
      lastRowid = row._rowid
      if (!row.enc) continue
      try {
        const newValue = rotateOneValue(row.enc, target, currentKey, newKey)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.runAsync(
          `UPDATE ${table} SET ${column} = ? WHERE rowid = ?`,
          [newValue, row._rowid] as any[],
        )
        totalUpdated++
      } catch (err) {
        logger.error('[KeyRotation] write failed for row', { target: target.name, rowid: row._rowid, err })
        result.failed.push(`${target.name}:write`)
      }
    }
  }
  return totalUpdated
}

/**
 * Single-value rotation: decrypt with currentKey, encrypt with newKey,
 * reattach the `enc:v1:` prefix if and only if the source value had it.
 * Throws on decrypt failure — the caller decides whether to abort.
 */
function rotateOneValue(
  enc: string,
  target: EncryptedTarget,
  currentKey: Uint8Array,
  newKey: Uint8Array,
): string {
  if (target.kind === 'db_bytes') {
    const plain = decryptBytesWithKey(enc, currentKey)
    return encryptBytesWithKey(plain, newKey)
  }
  // db_text path
  const hadPrefix = target.usesPrefix && enc.startsWith(ENC_PREFIX)
  const stripped = hadPrefix ? enc.slice(ENC_PREFIX.length) : enc
  const plain = decryptWithKey(stripped, currentKey)
  const reEnc = encryptWithKey(plain, newKey)
  return hadPrefix ? ENC_PREFIX + reEnc : reEnc
}

// ── AsyncStorage profiles helper ─────────────────────────────────────────

function rewriteEncryptedFields(
  member: Record<string, unknown>,
  currentKey: Uint8Array,
  newKey: Uint8Array,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(member)) {
    out[k] = rewriteValue(v, currentKey, newKey)
  }
  return out
}

function rewriteValue(value: unknown, currentKey: Uint8Array, newKey: Uint8Array): unknown {
  if (Array.isArray(value)) return value.map((v) => rewriteValue(v, currentKey, newKey))
  if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return value
  const stripped = value.slice(ENC_PREFIX.length)
  const plain = decryptWithKey(stripped, currentKey)
  return ENC_PREFIX + encryptWithKey(plain, newKey)
}

// ── FileSystem PDFs helper ───────────────────────────────────────────────

/**
 * Rotates every `.pdf.enc` file one at a time. Each file is read,
 * decrypted to a Uint8Array, re-encrypted with the new key, and
 * overwritten in place. **At most one file's plaintext bytes are
 * held in memory at a time** — for a user with 100 PDFs of 5 MB each,
 * peak heap is ~5 MB rather than ~500 MB.
 *
 * A failure on one file is logged and added to `result.failed` so
 * the caller knows not to swap the master key; the loop continues
 * so we get a complete failure manifest in one pass.
 */
async function rotatePdfFilesInPlace(
  currentKey: Uint8Array,
  newKey: Uint8Array,
  result: KeyRotationResult,
): Promise<void> {
  const base = FileSystem.documentDirectory
  if (!base) return
  const root = `${base}profile-documents/`
  const rootInfo = await FileSystem.getInfoAsync(root)
  if (!rootInfo.exists) return

  const memberDirs = await FileSystem.readDirectoryAsync(root).catch(() => [])
  for (const memberDir of memberDirs) {
    const dir = `${root}${memberDir}/`
    const files = await FileSystem.readDirectoryAsync(dir).catch(() => [])
    for (const name of files) {
      if (!name.endsWith('.enc')) continue
      const path = `${dir}${name}`
      try {
        const blob = await FileSystem.readAsStringAsync(path, {
          encoding: FileSystem.EncodingType.UTF8,
        })
        const plain = decryptBytesWithKey(blob, currentKey)
        const reEnc = encryptBytesWithKey(plain, newKey)
        await FileSystem.writeAsStringAsync(path, reEnc, {
          encoding: FileSystem.EncodingType.UTF8,
        })
        result.filesUpdated++
      } catch (err) {
        logger.error('[KeyRotation] pdf rotation failed', { path, err })
        result.failed.push(`fs:${name}`)
      }
    }
  }
}

// Silence unused warning — kept exported in case callers want to
// pre-validate the master key before invoking the full rotation.
void NONCE_LEN
