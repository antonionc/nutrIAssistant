import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import { gcm } from '@noble/ciphers/aes.js'
import { utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils.js'

// Field-level AES-GCM-256 for sensitive medical data at rest. The 256-bit
// master key is generated on first launch and persisted in the iOS Keychain
// / Android Keystore via expo-secure-store. OS-level sandboxing protects the
// rest; this layer adds defense against backup/exfiltration scenarios.
const KEY_NAME = 'nutri_master_key_v1'
const NONCE_LEN = 12
const KEY_LEN = 32

let cachedKey: Uint8Array | null = null

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  // global.btoa is available in React Native (Hermes) since 0.71+.
  return globalThis.btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

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

// Convenience for "this might or might not be encrypted" migration paths.
// If the input doesn't look like a valid base64 ciphertext, returns it as-is.
export function tryDecrypt(value: string): string {
  try {
    return decrypt(value)
  } catch {
    return value
  }
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
