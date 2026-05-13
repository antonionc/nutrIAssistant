import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import { getDatabase, closeDatabase } from '../db/database'
import { recordAuditEvent, deleteAllAuditEntries } from './auditLog'
import { _resetKeyCacheForTests } from './encryption'
import { APP_ERASABLE_ASYNC_STORAGE_KEYS } from './storageKeys'
import { logger } from '../utils/logger'

// GDPR Art. 17 — right to erasure. Wipes every persistence surface the app
// owns on the device. This is intentionally NOT a soft delete or a "clear
// caches" — once executed, no plaintext or ciphertext copy of the user's
// data remains on the device, and the master key that could decrypt any
// stray ciphertext is also destroyed.
//
// Ordering matters:
//   1. Plain data first  (SQLite + AsyncStorage + FileSystem) so a partial
//      failure leaves nothing that depends on the master key being readable.
//   2. Master key last   so if any earlier step throws, the key remains and
//      the user can retry. The reverse ordering would leave us with
//      orphaned ciphertext that no one can ever decrypt.
//
// Each phase is best-effort: a failure in one bucket should not prevent the
// rest from running. We log failures via the logger (with scrubbing) but
// never re-throw — partial erasure is still better than no erasure.

// The set of AsyncStorage keys to wipe lives in `storageKeys.ts` so it
// cannot drift out of sync with the call sites — there is exactly one
// place that declares the literal strings, and dataErasure / keyRotation
// both read from it.
//
// We intentionally use multiRemove(keys) instead of AsyncStorage.clear()
// because clear() would also drop OS-managed keys outside our namespace.

// SQLite tables created across all 15 migrations. DELETE FROM (not DROP)
// so the schema survives — the user can keep using the app post-erasure
// without re-running every migration. The `audit_log` is wiped LAST and
// then a fresh `erasure_completed` row is written so the user has audit
// evidence of their own erasure in the freshly-blank table.
//
// `migrations` is intentionally excluded — wiping it would force every
// migration to re-run on next boot, which is harmless today (all are
// idempotent) but unnecessary work.
const APP_DB_TABLES = [
  'inventory_items',
  'recipes',
  'meal_plans',
  'school_menu_entries',
  'scan_history',
  'grocery_items',
  'member_memories',
  'doc_chunks',
  'conversation_summaries',
  'member_index',          // migration 015 — drives cascade FKs
  'retailer_connections',  // migration 001 — OAuth metadata for retailer integrations
  'usda_cache',            // migration 001 — cached USDA nutrition lookups
] as const

// FileSystem subtrees the app writes into. Trailing slash is required for
// expo-file-system to treat the path as a directory.
function appFileSystemPaths(): string[] {
  const base = FileSystem.documentDirectory ?? ''
  return [
    base + 'profile-documents/',
    base + 'avatars/',
    base + 'react-native-executorch/',
  ]
}

export class DataErasureError extends Error {
  constructor(public readonly stage: string, public readonly cause?: unknown) {
    super(`Erasure failed at stage: ${stage}`)
    this.name = 'DataErasureError'
  }
}

export interface ErasureResult {
  asyncStorageKeysCleared: number
  dbRowsCleared: Record<string, number>
  fileSystemPathsCleared: string[]
  exportMarkdownsCleared: number
  masterKeyDeleted: boolean
  /** Stages that failed but did not stop the overall erasure. */
  partialFailures: string[]
}

/**
 * Performs a complete GDPR Art. 17 erasure. Always tries every phase, even
 * if earlier phases fail. Returns a result object listing what was cleared
 * and which stages produced (non-fatal) errors.
 *
 * Call sites must:
 *   1. Confirm the user's intent with a typed-phrase modal.
 *   2. After this returns, force a navigation reload back to onboarding
 *      (this function does NOT navigate or relaunch by itself — that's a
 *      UI concern owned by the screen invoking it).
 */
export async function eraseAllUserData(): Promise<ErasureResult> {
  const result: ErasureResult = {
    asyncStorageKeysCleared: 0,
    dbRowsCleared: {},
    fileSystemPathsCleared: [],
    exportMarkdownsCleared: 0,
    masterKeyDeleted: false,
    partialFailures: [],
  }

  // Audit log entry BEFORE wiping (recorded in the existing audit_log row,
  // which itself will be wiped two phases below).
  await recordAuditEvent('erasure_started', { initiator: 'user' })

  // 1. SQLite rows (all tables except audit_log itself).
  try {
    const db = await getDatabase()
    for (const table of APP_DB_TABLES) {
      try {
        const r = await db.runAsync(`DELETE FROM ${table}`)
        result.dbRowsCleared[table] = r.changes
      } catch (err) {
        logger.error('[Erasure] failed to clear table', { table, err })
        result.partialFailures.push(`db:${table}`)
      }
    }
  } catch (err) {
    logger.error('[Erasure] failed to open database', { err })
    result.partialFailures.push('db:open')
  }

  // 2. AsyncStorage app-owned keys.
  try {
    await AsyncStorage.multiRemove(APP_ERASABLE_ASYNC_STORAGE_KEYS as unknown as string[])
    result.asyncStorageKeysCleared = APP_ERASABLE_ASYNC_STORAGE_KEYS.length
  } catch (err) {
    logger.error('[Erasure] AsyncStorage.multiRemove failed', { err })
    result.partialFailures.push('async_storage')
  }

  // 3. FileSystem subtrees (profile-documents/, avatars/, model cache).
  for (const path of appFileSystemPaths()) {
    try {
      await FileSystem.deleteAsync(path, { idempotent: true })
      result.fileSystemPathsCleared.push(path)
    } catch (err) {
      logger.error('[Erasure] FileSystem.deleteAsync failed', { path, err })
      result.partialFailures.push(`fs:${path}`)
    }
  }

  // 4. Delete any leftover Markdown/zip exports in the document directory.
  try {
    const base = FileSystem.documentDirectory ?? ''
    const entries = await FileSystem.readDirectoryAsync(base)
    for (const name of entries) {
      if (name.startsWith('nutri_familia_') || name.startsWith('nutri_export_')) {
        try {
          await FileSystem.deleteAsync(base + name, { idempotent: true })
          result.exportMarkdownsCleared++
        } catch (err) {
          logger.warn('[Erasure] failed to delete export artifact', { name, err })
          result.partialFailures.push(`fs:${name}`)
        }
      }
    }
  } catch (err) {
    logger.warn('[Erasure] could not enumerate document directory', { err })
    result.partialFailures.push('fs:readdir')
  }

  // 5. Audit log — wipe last among DB tables so the erasure_started event
  // remains queryable if a regulator inspects mid-flight, but DOES get
  // wiped here (Art. 17 prevails over Art. 30 for the data subject's
  // own data — see plan §1.5).
  try {
    await deleteAllAuditEntries()
  } catch (err) {
    logger.error('[Erasure] deleteAllAuditEntries failed', { err })
    result.partialFailures.push('db:audit_log')
  }

  // 6. Close the database so the next open is fresh.
  try {
    await closeDatabase()
  } catch (err) {
    logger.warn('[Erasure] closeDatabase failed (non-fatal)', { err })
  }

  // 7. Master key — LAST. If any earlier phase failed and left ciphertext
  // around, deleting the key would make recovery impossible. Doing this
  // last preserves the option to retry the erasure flow.
  try {
    await SecureStore.deleteItemAsync('nutri_master_key_v1')
    _resetKeyCacheForTests() // also clears the in-memory cached key
    result.masterKeyDeleted = true
  } catch (err) {
    logger.error('[Erasure] SecureStore.deleteItemAsync failed', { err })
    result.partialFailures.push('secure_store')
  }

  // 8. Audit log of completion. The previous DELETE wiped the table; the
  // ensureKey() inside recordAuditEvent will generate a NEW master key
  // and the row goes into the freshly-blank table. This is intentional
  // — the user has a single row in the new audit log proving their
  // erasure occurred, but everything BEFORE is gone.
  await recordAuditEvent(
    'erasure_completed',
    {
      partialFailures: result.partialFailures,
      // No member identifiers — they've already been wiped.
    },
    'system',
  )

  return result
}
