// Mocks must be declared before importing the module under test.
const memSecureStore: Record<string, string> = {}

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => memSecureStore[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    memSecureStore[key] = value
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete memSecureStore[key]
  }),
}))

jest.mock('expo-crypto', () => ({
  // Deterministic-but-different bytes per call so nonces don't repeat.
  getRandomBytes: (n: number) => {
    const arr = new Uint8Array(n)
    for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256)
    return arr
  },
}))

import {
  ensureKey,
  encrypt,
  decrypt,
  encryptBytes,
  decryptBytes,
  isKeyReady,
  _resetKeyCacheForTests,
} from '../../services/encryption'

describe('encryption (AES-GCM-256)', () => {
  beforeEach(() => {
    _resetKeyCacheForTests()
    for (const k of Object.keys(memSecureStore)) delete memSecureStore[k]
  })

  it('ensureKey persists a 256-bit key on first call', async () => {
    expect(isKeyReady()).toBe(false)
    await ensureKey()
    expect(isKeyReady()).toBe(true)
    // 32-byte key encoded as base64 → 44 chars including padding.
    expect(memSecureStore['nutri_master_key_v1'].length).toBeGreaterThanOrEqual(40)
  })

  it('ensureKey is idempotent — second call reuses the persisted key', async () => {
    await ensureKey()
    const first = memSecureStore['nutri_master_key_v1']
    _resetKeyCacheForTests()
    await ensureKey()
    expect(memSecureStore['nutri_master_key_v1']).toBe(first)
  })

  it('roundtrips short ASCII strings', async () => {
    await ensureKey()
    const blob = encrypt('hello')
    expect(blob).not.toBe('hello')
    expect(decrypt(blob)).toBe('hello')
  })

  it('roundtrips Unicode (Spanish accents, emoji)', async () => {
    await ensureKey()
    const plain = '¿Qué tal? — alérgenos: 🥜🌾'
    expect(decrypt(encrypt(plain))).toBe(plain)
  })

  it('roundtrips long strings (4 KB of medical-style text)', async () => {
    await ensureKey()
    const plain = 'paciente: ' + 'glucosa 105 mg/dl, colesterol total 230, '.repeat(80)
    expect(decrypt(encrypt(plain))).toBe(plain)
  })

  it('produces a different ciphertext on each encrypt (random nonce)', async () => {
    await ensureKey()
    const a = encrypt('same plaintext')
    const b = encrypt('same plaintext')
    expect(a).not.toBe(b)
  })

  it('throws when ciphertext has been tampered with', async () => {
    await ensureKey()
    const blob = encrypt('do not modify')
    // Flip a byte mid-cipher (after the 12-byte nonce)
    const bytes = Buffer.from(blob, 'base64')
    bytes[bytes.length - 1] ^= 0x01
    const tampered = bytes.toString('base64')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('roundtrips arbitrary bytes (used for embeddings)', async () => {
    await ensureKey()
    const buf = new Uint8Array([1, 2, 3, 250, 251, 252])
    const out = decryptBytes(encryptBytes(buf))
    expect(Array.from(out)).toEqual(Array.from(buf))
  })

  it('throws on encrypt() before ensureKey()', () => {
    _resetKeyCacheForTests()
    expect(() => encrypt('x')).toThrow(/ensureKey/)
  })
})
