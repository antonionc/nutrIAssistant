// Mocks set up before imports.
const memSecureStore: Record<string, string> = {}
const memAsyncStorage: Record<string, string> = {}

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
    for (let i = 0; i < n; i++) arr[i] = (i * 13 + 5) % 256
    return arr
  },
}))

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => memAsyncStorage[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      memAsyncStorage[k] = v
    }),
  },
}))

import { ensureKey, _resetKeyCacheForTests } from '../../../services/encryption'
import {
  loadProfiles,
  saveProfiles,
  migrateProfilesToEncryptedFields,
} from '../../../modules/profiles/profileStorage'
import type { FamilyMember } from '../../../types/profiles'

function makeMember(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'm-1',
    name: 'Carlos',
    role: 'father',
    dateOfBirth: '1985-04-12',
    weight: 80,
    height: 180,
    allergies: ['gluten'],
    conditions: ['celiac'],
    dietPreference: 'mediterranean',
    isSchoolAge: false,
    favoriteRecipeIds: [],
    documents: [],
    aboutMeNotes: 'I train 3x a week',
    isSuperUser: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('profileStorage — Art. 9 field encryption', () => {
  beforeEach(async () => {
    _resetKeyCacheForTests()
    for (const k of Object.keys(memSecureStore)) delete memSecureStore[k]
    for (const k of Object.keys(memAsyncStorage)) delete memAsyncStorage[k]
    await ensureKey()
  })

  it('weight, height, dateOfBirth, allergies, conditions, aboutMeNotes are ciphertext on disk', async () => {
    await saveProfiles([makeMember()])
    const raw = memAsyncStorage['family_profiles']
    expect(raw).toBeTruthy()

    // Plaintext values must NOT appear in the stored JSON.
    expect(raw).not.toContain('"weight":80')
    expect(raw).not.toContain('"height":180')
    expect(raw).not.toContain('1985-04-12')
    expect(raw).not.toContain('gluten')
    expect(raw).not.toContain('celiac')
    expect(raw).not.toContain('train 3x a week')

    // But name/role/dietPreference stay plaintext for cheap rendering.
    expect(raw).toContain('Carlos')
    expect(raw).toContain('father')
    expect(raw).toContain('mediterranean')

    // The ENC_PREFIX appears in the ciphertext markers.
    expect(raw).toContain('enc:v1:')
  })

  it('roundtrips: saveProfiles → loadProfiles yields the original plaintext values', async () => {
    const original = makeMember()
    await saveProfiles([original])
    const loaded = await loadProfiles()
    expect(loaded).toHaveLength(1)
    const m = loaded[0]
    expect(m.weight).toBe(80)
    expect(m.height).toBe(180)
    expect(m.dateOfBirth).toBe('1985-04-12')
    expect(m.allergies).toEqual(['gluten'])
    expect(m.conditions).toEqual(['celiac'])
    expect(m.aboutMeNotes).toBe('I train 3x a week')
    expect(m.name).toBe('Carlos') // unchanged
  })

  it('reads legacy plaintext payloads (pre-Sprint-2 installs)', async () => {
    // Simulate an install that wrote profiles BEFORE this sprint —
    // weight/height/dob/allergies are still plaintext on disk.
    memAsyncStorage['family_profiles'] = JSON.stringify([
      {
        id: 'legacy-1',
        name: 'Legacy',
        role: 'mother',
        dateOfBirth: '1990-01-01',
        weight: 65,
        height: 165,
        allergies: ['dairy'],
        conditions: [], // not yet encrypted in some pre-Sprint-1 installs
        dietPreference: 'none',
        isSchoolAge: false,
        favoriteRecipeIds: [],
        documents: [],
        isSuperUser: false,
        createdAt: '2025-12-01T00:00:00Z',
        updatedAt: '2025-12-01T00:00:00Z',
      },
    ])
    const loaded = await loadProfiles()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].weight).toBe(65)
    expect(loaded[0].height).toBe(165)
    expect(loaded[0].dateOfBirth).toBe('1990-01-01')
    expect(loaded[0].allergies).toEqual(['dairy'])
  })

  it('migrateProfilesToEncryptedFields rewrites a legacy plaintext payload as ciphertext', async () => {
    memAsyncStorage['family_profiles'] = JSON.stringify([
      {
        id: 'legacy-1',
        name: 'Legacy',
        role: 'mother',
        dateOfBirth: '1990-01-01',
        weight: 65,
        height: 165,
        allergies: ['dairy'],
        conditions: [],
        dietPreference: 'none',
        isSchoolAge: false,
        favoriteRecipeIds: [],
        documents: [],
        isSuperUser: false,
        createdAt: '2025-12-01T00:00:00Z',
        updatedAt: '2025-12-01T00:00:00Z',
      },
    ])
    await migrateProfilesToEncryptedFields()
    const raw = memAsyncStorage['family_profiles']
    expect(raw).not.toContain('"weight":65')
    expect(raw).not.toContain('1990-01-01')
    expect(raw).not.toContain('dairy')
    expect(raw).toContain('enc:v1:')

    // Round-trip still works after migration.
    const loaded = await loadProfiles()
    expect(loaded[0].weight).toBe(65)
    expect(loaded[0].dateOfBirth).toBe('1990-01-01')
  })

  it('migrate is idempotent — running twice does not double-encrypt', async () => {
    await saveProfiles([makeMember()])
    const firstRaw = memAsyncStorage['family_profiles']
    await migrateProfilesToEncryptedFields()
    await migrateProfilesToEncryptedFields()
    const finalRaw = memAsyncStorage['family_profiles']
    // We can't assert byte-equality (random nonce), but the loaded values
    // must still decrypt cleanly.
    const loaded = await loadProfiles()
    expect(loaded[0].weight).toBe(80)
    expect(finalRaw).toContain('enc:v1:')
    // The number of enc:v1: occurrences should stay stable across runs
    const countA = (firstRaw.match(/enc:v1:/g) ?? []).length
    const countB = (finalRaw.match(/enc:v1:/g) ?? []).length
    expect(countA).toBe(countB)
  })
})
