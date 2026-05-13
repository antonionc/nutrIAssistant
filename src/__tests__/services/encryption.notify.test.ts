// Mocks set up before imports.
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
  getRandomBytes: (n: number) => {
    const arr = new Uint8Array(n)
    for (let i = 0; i < n; i++) arr[i] = (i * 11 + 7) % 256
    return arr
  },
}))

import {
  ensureKey,
  encrypt,
  tryDecrypt,
  subscribeDecryptFailures,
  _resetKeyCacheForTests,
  _resetDecryptFailureListenersForTests,
} from '../../services/encryption'

describe('encryption — decrypt-failure notifier', () => {
  beforeEach(async () => {
    _resetKeyCacheForTests()
    _resetDecryptFailureListenersForTests()
    for (const k of Object.keys(memSecureStore)) delete memSecureStore[k]
    await ensureKey()
  })

  it('fires the listener when a base64-shaped ciphertext fails to decrypt', async () => {
    const listener = jest.fn()
    subscribeDecryptFailures(listener)

    const blob = encrypt('secret')
    // Tamper with the last byte.
    const bytes = Buffer.from(blob, 'base64')
    bytes[bytes.length - 1] ^= 0xff
    const tampered = bytes.toString('base64')

    const result = tryDecrypt(tampered)
    expect(listener).toHaveBeenCalledTimes(1)
    // tryDecrypt still returns the raw value so the caller does not crash.
    expect(result).toBe(tampered)
  })

  it('does not fire when input is obviously plaintext (legacy unencrypted)', () => {
    const listener = jest.fn()
    subscribeDecryptFailures(listener)
    const result = tryDecrypt('plain hello')
    expect(listener).not.toHaveBeenCalled()
    expect(result).toBe('plain hello')
  })

  it('returns the plaintext when the input is a valid ciphertext (no listener fired)', () => {
    const listener = jest.fn()
    subscribeDecryptFailures(listener)
    const blob = encrypt('valid')
    const out = tryDecrypt(blob)
    expect(out).toBe('valid')
    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribe stops further notifications', () => {
    const listener = jest.fn()
    const unsub = subscribeDecryptFailures(listener)
    const blob = encrypt('x')
    const bytes = Buffer.from(blob, 'base64')
    bytes[bytes.length - 1] ^= 0xff
    const tampered = bytes.toString('base64')

    tryDecrypt(tampered)
    expect(listener).toHaveBeenCalledTimes(1)

    unsub()
    tryDecrypt(tampered)
    expect(listener).toHaveBeenCalledTimes(1) // unchanged
  })

  it('a misbehaving listener does not break tryDecrypt', () => {
    subscribeDecryptFailures(() => {
      throw new Error('listener exploded')
    })
    const blob = encrypt('y')
    const bytes = Buffer.from(blob, 'base64')
    bytes[bytes.length - 1] ^= 0xff
    const tampered = bytes.toString('base64')
    expect(() => tryDecrypt(tampered)).not.toThrow()
  })
})
