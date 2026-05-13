import * as FileSystem from 'expo-file-system/legacy'
import { encryptBytes, decryptBytes, ensureKey } from './encryption'
import { bytesToBase64, base64ToBytes } from '../utils/base64'
import { logger } from '../utils/logger'

// Disk encryption wrapper for arbitrary binary files (PDFs, future uploads).
// Files at rest are AES-GCM-256-encrypted with the same master key as the
// rest of the field-level encryption. Reading them back requires a brief
// plaintext window in the OS cache directory — kept as short as possible
// (delete in `finally`) and not backed up to iCloud/Google Drive.
//
// Why a JS-side wrapper rather than iOS Data Protection / Android
// EncryptedFile:
//   1. iOS `NSFileProtectionComplete` only protects the file while the
//      device is locked, not while backgrounded mid-session. Medical data
//      needs at-rest protection even with the device unlocked.
//   2. Android `EncryptedFile` requires a Kotlin native module that we
//      currently do not ship; adding one would mean a config plugin +
//      Gradle changes.
//   3. The `encryptBytes`/`decryptBytes` API exists already (see
//      `src/services/encryption.ts:88-105`).
//
// On-disk format mirrors the in-memory blob produced by `encryptBytes`:
//   base64(nonce(12) || ciphertext || tag(16))
// stored as UTF-8 text in a `.enc` file. The choice of base64 (vs raw
// bytes) is for `writeAsStringAsync` ergonomics — expo-file-system v55
// does not expose a raw-binary write API.

const ENC_SUFFIX = '.enc'

export function isEncryptedPath(path: string): boolean {
  return path.endsWith(ENC_SUFFIX)
}

export function withEncryptedSuffix(path: string): string {
  return isEncryptedPath(path) ? path : path + ENC_SUFFIX
}

/**
 * Reads bytes from `sourceUri`, encrypts them, writes the ciphertext (as
 * base64 text) to `destPath` with a `.enc` suffix appended. The original
 * source file is NOT deleted — caller decides.
 *
 * Returns the destination path with `.enc` suffix.
 */
export async function writeEncryptedFile(
  sourceUri: string,
  destPath: string,
): Promise<string> {
  await ensureKey()
  const base64 = await FileSystem.readAsStringAsync(sourceUri, {
    encoding: FileSystem.EncodingType.Base64,
  })
  const bytes = base64ToBytes(base64)
  const blob = encryptBytes(bytes)
  const finalPath = withEncryptedSuffix(destPath)
  await FileSystem.writeAsStringAsync(finalPath, blob, {
    encoding: FileSystem.EncodingType.UTF8,
  })
  // KNOWN LIMITATION: expo-file-system v55 (both `legacy` and the modern
  // File/Directory API) does NOT expose a way to set
  // `NSURLIsExcludedFromBackupKey` on iOS or to opt out of Android Auto
  // Backup at the per-file level. We checked the v55 surface — the
  // method does not exist. Until either:
  //   (a) Expo adds the API in a future SDK, or
  //   (b) we ship a custom native module that calls
  //       `URL.setResourceValues(_:)` on iOS and writes a
  //       `data_extraction_rules.xml` exclusion for Android,
  // the encrypted `.pdf.enc` files DO get backed up to iCloud / Google
  // Drive when the user has those services enabled. The bytes are
  // ciphertext (AES-GCM-256 with a key in the device Keychain that
  // does NOT leave the device), so the leak surface is "ciphertext in
  // a third-party cloud", not "plaintext PDFs". This is documented in
  // `docs/store-readiness/privacy-labels.md` § "Security practices".
  return finalPath
}

/**
 * Decrypts an `.enc` file into the OS cache directory and returns:
 *   - `tempUri`: an absolute path to the plaintext copy (suitable for any
 *     pdf-text extractor or viewer that expects a regular file URI).
 *   - `dispose()`: an async cleanup function the caller MUST invoke in a
 *     `finally` block.
 *
 * Throws if the source file does not exist or fails to decrypt.
 */
export async function readEncryptedToTemp(
  encPath: string,
): Promise<{ tempUri: string; dispose: () => Promise<void> }> {
  await ensureKey()
  const blob = await FileSystem.readAsStringAsync(encPath, {
    encoding: FileSystem.EncodingType.UTF8,
  })
  const plain = decryptBytes(blob)
  // Cache directory is OS-cleanable and NOT backed up.
  const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ''
  const tempUri = `${base}plain-${Date.now()}-${Math.floor(Math.random() * 1e6)}.bin`
  await FileSystem.writeAsStringAsync(tempUri, bytesToBase64(plain), {
    encoding: FileSystem.EncodingType.Base64,
  })
  const dispose = async () => {
    try {
      await FileSystem.deleteAsync(tempUri, { idempotent: true })
    } catch (err) {
      logger.warn('[secureFileStore] could not delete temp plaintext', { err })
    }
  }
  return { tempUri, dispose }
}

/**
 * Re-encrypts every plaintext `.pdf` file under `profile-documents/` into
 * its `.enc` sibling, then deletes the plaintext. Idempotent: if a
 * matching `.enc` already exists, the plaintext is just removed.
 *
 * This is the one-shot boot migration for installs that uploaded PDFs
 * before this sprint landed. Designed to be cheap on the happy path
 * (no plaintext PDFs) and recoverable on partial failures.
 */
export async function migratePlaintextDocumentsToEncrypted(): Promise<{
  encrypted: number
  alreadyMigrated: number
  failed: number
}> {
  const base = FileSystem.documentDirectory
  if (!base) return { encrypted: 0, alreadyMigrated: 0, failed: 0 }
  const root = `${base}profile-documents/`
  const result = { encrypted: 0, alreadyMigrated: 0, failed: 0 }
  const rootInfo = await FileSystem.getInfoAsync(root)
  if (!rootInfo.exists) return result

  let memberDirs: string[] = []
  try {
    memberDirs = await FileSystem.readDirectoryAsync(root)
  } catch {
    return result
  }
  await ensureKey()
  for (const memberDir of memberDirs) {
    const dir = `${root}${memberDir}/`
    let files: string[] = []
    try {
      files = await FileSystem.readDirectoryAsync(dir)
    } catch {
      continue
    }
    for (const name of files) {
      if (!name.endsWith('.pdf')) continue // skip already-encrypted .enc and anything else
      const plain = `${dir}${name}`
      const encDst = `${plain}${ENC_SUFFIX}`
      try {
        const encExists = await FileSystem.getInfoAsync(encDst)
        if (encExists.exists) {
          // Already migrated in a previous boot — just clean up the
          // straggler plaintext copy.
          await FileSystem.deleteAsync(plain, { idempotent: true })
          result.alreadyMigrated++
          continue
        }
        await writeEncryptedFile(plain, plain) // dest is plain → becomes plain.enc
        await FileSystem.deleteAsync(plain, { idempotent: true })
        result.encrypted++
      } catch (err) {
        logger.error('[secureFileStore] migration failed for file', { name, err })
        result.failed++
      }
    }
  }
  return result
}

// base64 helpers live in `src/utils/base64.ts` — same instance used by
// encryption.ts and keyRotation.ts. Pre-centralisation, three identical
// copies lived in three files.
