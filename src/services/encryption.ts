import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import { gcm } from '@noble/ciphers/aes.js'
import { utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils.js'
import { bytesToBase64, base64ToBytes } from '../utils/base64'

// Field-level AES-GCM-256 for sensitive medical data at rest. The 256-bit
// master key is generated on first launch and persisted in the iOS Keychain
// / Android Keystore via expo-secure-store. OS-level sandboxing protects the
// rest; this layer adds defense against backup/exfiltration scenarios.
const KEY_NAME = 'nutri_master_key_v1'
export const NONCE_LEN = 12
const KEY_LEN = 32

let cachedKey: Uint8Array | null = null

// Idempotent: returns the existing key if present, generates+persists otherwise.
// Must be awaited before any encrypt/decrypt call. Call once at app boot,
// before profile loading.
export async function ensureKey(): Promise<void> {
  if (cachedKey) return
  const existing = await SecureStore.getItemAsync(KEY_NAME)
  if (existing) {
    cachedKey = base64ToBytes(existing)
    if (cachedKey.length !== KEY_LEN) {
      // Corrupt key — regenerate. Old ciphertexts become unreadable; this is
      // safer than continuing with a partial key.
      cachedKey = null
    }
  }
  if (!cachedKey) {
    cachedKey = Crypto.getRandomBytes(KEY_LEN)
    await SecureStore.setItemAsync(KEY_NAME, bytesToBase64(cachedKey))
  }
}

export function isKeyReady(): boolean {
  return cachedKey !== null
}

// Encrypts a UTF-8 string. Output is base64(nonce(12) || ct || tag(16)).
// Throws if ensureKey() hasn't been called yet.
export function encrypt(plaintext: string): string {
  if (!cachedKey) throw new Error('encryption.ensureKey() must run before encrypt()')
  const nonce = Crypto.getRandomBytes(NONCE_LEN)
  const ct = gcm(cachedKey, nonce).encrypt(utf8ToBytes(plaintext))
  const out = new Uint8Array(NONCE_LEN + ct.length)
  out.set(nonce, 0)
  out.set(ct, NONCE_LEN)
  return bytesToBase64(out)
}

// Decrypts a base64 blob produced by encrypt(). Throws on tamper / wrong key.
export function decrypt(blob: string): string {
  if (!cachedKey) throw new Error('encryption.ensureKey() must run before decrypt()')
  const bytes = base64ToBytes(blob)
  if (bytes.length <= NONCE_LEN) throw new Error('Ciphertext too short')
  const nonce = bytes.subarray(0, NONCE_LEN)
  const ct = bytes.subarray(NONCE_LEN)
  const pt = gcm(cachedKey, nonce).decrypt(ct)
  return bytesToUtf8(pt)
}

// Subscribers to decrypt-failure events. The UI registers one to show a
// banner; the audit log registers one to record a `decrypt_failure` event.
// Failures are interesting (the master key may have been wiped, replaced,
// or a row may be corrupt), but they must not crash the calling flow —
// `tryDecrypt` always returns a usable string. The subscribers are the
// out-of-band signal for the UI/audit layer to react.
type DecryptFailureListener = () => void
const decryptFailureListeners = new Set<DecryptFailureListener>()

export function subscribeDecryptFailures(fn: DecryptFailureListener): () => void {
  decryptFailureListeners.add(fn)
  return () => {
    decryptFailureListeners.delete(fn)
  }
}

function notifyDecryptFailure(): void {
  for (const fn of decryptFailureListeners) {
    try {
      fn()
    } catch {
      // A misbehaving listener must not break the decrypt path.
    }
  }
}

// Convenience for "this might or might not be encrypted" migration paths.
// If the input doesn't look like a valid base64 ciphertext, returns it as-is.
// When the input LOOKS encrypted (passes the size check inside decrypt) but
// fails to decrypt (wrong key, tampered, corrupt), we fire the failure
// listeners so the UI can react — but we still return the raw value to
// keep the caller's flow alive.
export function tryDecrypt(value: string): string {
  try {
    return decrypt(value)
  } catch {
    // Cheap heuristic: a string longer than NONCE_LEN that decodes to
    // bytes was intended as ciphertext. If it's much shorter or contains
    // non-base64 chars, it's almost certainly legacy plaintext and we
    // skip the notification.
    if (value.length > NONCE_LEN * 2 && /^[A-Za-z0-9+/=]+$/.test(value)) {
      notifyDecryptFailure()
    }
    return value
  }
}

// Test-only helper: clear all decrypt-failure listeners between test cases.
export function _resetDecryptFailureListenersForTests(): void {
  decryptFailureListeners.clear()
}

// Encrypt arbitrary bytes (used for embedding vectors stored as BLOB).
export function encryptBytes(plain: Uint8Array): string {
  if (!cachedKey) throw new Error('encryption.ensureKey() must run before encryptBytes()')
  const nonce = Crypto.getRandomBytes(NONCE_LEN)
  const ct = gcm(cachedKey, nonce).encrypt(plain)
  const out = new Uint8Array(NONCE_LEN + ct.length)
  out.set(nonce, 0)
  out.set(ct, NONCE_LEN)
  return bytesToBase64(out)
}

export function decryptBytes(blob: string): Uint8Array {
  if (!cachedKey) throw new Error('encryption.ensureKey() must run before decryptBytes()')
  const bytes = base64ToBytes(blob)
  if (bytes.length <= NONCE_LEN) throw new Error('Ciphertext too short')
  const nonce = bytes.subarray(0, NONCE_LEN)
  const ct = bytes.subarray(NONCE_LEN)
  return gcm(cachedKey, nonce).decrypt(ct)
}

// Test-only helper. Resets the in-memory cache; the persisted key is unchanged.
export function _resetKeyCacheForTests(): void {
  cachedKey = null
}

// ── Master-key rotation primitives ──────────────────────────────────────
// These let `services/keyRotation.ts` re-encrypt every stored blob in
// memory before atomically swapping the persisted master key. They are
// NOT part of the public encrypt/decrypt path — call sites use the
// regular `encrypt`/`decrypt` helpers above.

const KEY_NAME_INTERNAL = KEY_NAME

/** Generates a fresh 256-bit candidate key WITHOUT persisting it. */
export function generateCandidateKey(): Uint8Array {
  return Crypto.getRandomBytes(KEY_LEN)
}

/** Encrypt a UTF-8 string with a caller-supplied key (not the cached one). */
export function encryptWithKey(plaintext: string, key: Uint8Array): string {
  const nonce = Crypto.getRandomBytes(NONCE_LEN)
  const ct = gcm(key, nonce).encrypt(utf8ToBytes(plaintext))
  const out = new Uint8Array(NONCE_LEN + ct.length)
  out.set(nonce, 0)
  out.set(ct, NONCE_LEN)
  return bytesToBase64(out)
}

/** Encrypt arbitrary bytes with a caller-supplied key. */
export function encryptBytesWithKey(plain: Uint8Array, key: Uint8Array): string {
  const nonce = Crypto.getRandomBytes(NONCE_LEN)
  const ct = gcm(key, nonce).encrypt(plain)
  const out = new Uint8Array(NONCE_LEN + ct.length)
  out.set(nonce, 0)
  out.set(ct, NONCE_LEN)
  return bytesToBase64(out)
}

/** Decrypt a UTF-8 string with a caller-supplied key. Mirror of `decrypt`. */
export function decryptWithKey(blob: string, key: Uint8Array): string {
  const bytes = base64ToBytes(blob)
  if (bytes.length <= NONCE_LEN) throw new Error('Ciphertext too short')
  const nonce = bytes.subarray(0, NONCE_LEN)
  const ct = bytes.subarray(NONCE_LEN)
  return bytesToUtf8(gcm(key, nonce).decrypt(ct))
}

/** Decrypt arbitrary bytes with a caller-supplied key. Mirror of `decryptBytes`. */
export function decryptBytesWithKey(blob: string, key: Uint8Array): Uint8Array {
  const bytes = base64ToBytes(blob)
  if (bytes.length <= NONCE_LEN) throw new Error('Ciphertext too short')
  const nonce = bytes.subarray(0, NONCE_LEN)
  const ct = bytes.subarray(NONCE_LEN)
  return gcm(key, nonce).decrypt(ct)
}

/**
 * Atomically swap the persisted master key. After this call returns
 * successfully, every subsequent encrypt/decrypt call uses the new key.
 *
 * Callers MUST have already re-encrypted every persisted ciphertext with
 * the new key before calling this — otherwise old ciphertexts become
 * unreadable until the next backup/restore.
 */
export async function swapMasterKey(newKey: Uint8Array): Promise<void> {
  if (newKey.length !== KEY_LEN) {
    throw new Error(`swapMasterKey: key must be ${KEY_LEN} bytes, got ${newKey.length}`)
  }
  await SecureStore.setItemAsync(KEY_NAME_INTERNAL, bytesToBase64(newKey))
  cachedKey = newKey
}
