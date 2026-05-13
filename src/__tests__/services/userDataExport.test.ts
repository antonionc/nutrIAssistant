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
    for (let i = 0; i < n; i++) arr[i] = (i * 7 + 3) % 256
    return arr
  },
}))

jest.mock('@react-native-async-storage/async-storage', () => {
  const mockMem: Record<string, string> = {
    family_profiles: JSON.stringify([
      { id: 'm-1', name: 'Carlos', role: 'father', dateOfBirth: '1985-01-01', favoriteRecipeIds: [], documents: [] },
    ]),
    family_name: 'TestFamily',
  }
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => mockMem[k] ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        mockMem[k] = v
      }),
      removeItem: jest.fn(async (k: string) => {
        delete mockMem[k]
      }),
      multiRemove: jest.fn(async (keys: string[]) => {
        for (const k of keys) delete mockMem[k]
      }),
    },
  }
})

// Captured file writes so the test can inspect what the export wrote.
const mockFsWrites: Record<string, string> = {}

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/fake/',
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  writeAsStringAsync: jest.fn(async (uri: string, data: string) => {
    mockFsWrites[uri] = data
  }),
  readAsStringAsync: jest.fn(async () => 'mock-pdf-bytes'),
  readDirectoryAsync: jest.fn(async (path: string) => {
    if (path.endsWith('profile-documents/m-1/')) return ['report.pdf']
    return []
  }),
  deleteAsync: jest.fn(async () => undefined),
}))

// In-memory DB shaped just enough for the export flow.
const mockDb = {
  async getAllAsync<T>(sql: string): Promise<T[]> {
    if (sql.includes('FROM meal_plans')) return [{ id: 'mp-1', date: '2026-05-13' }] as unknown as T[]
    if (sql.includes('FROM recipes')) return [{ id: 'r-1', name: 'Paella' }] as unknown as T[]
    if (sql.includes('FROM inventory_items')) return [] as T[]
    if (sql.includes('FROM grocery_items')) return [] as T[]
    if (sql.includes('FROM school_menu_entries')) return [] as T[]
    if (sql.includes('FROM scan_history')) return [] as T[]
    if (sql.includes('FROM member_memories')) return [] as T[]
    if (sql.includes('FROM doc_chunks')) return [] as T[]
    if (sql.includes('FROM conversation_summaries')) return [] as T[]
    if (sql.includes('FROM audit_log')) return [] as T[]
    return [] as T[]
  },
  async runAsync(_sql: string, _params: unknown[] = []): Promise<{ changes: number }> {
    return { changes: 0 }
  },
}

jest.mock('../../db/database', () => ({
  getDatabase: async () => mockDb,
  closeDatabase: async () => {},
}))

import { exportAllUserData } from '../../services/userDataExport'

import JSZip from 'jszip'

describe('exportAllUserData', () => {
  beforeEach(() => {
    for (const k of Object.keys(memSecureStore)) delete memSecureStore[k]
    for (const k of Object.keys(mockFsWrites)) delete mockFsWrites[k]
  })

  it('writes a zip with the expected files at the document directory', async () => {
    const { uri, manifest } = await exportAllUserData('1.2.3')
    expect(uri.startsWith('/tmp/fake/nutri_export_')).toBe(true)
    expect(uri.endsWith('.zip')).toBe(true)

    expect(manifest.appVersion).toBe('1.2.3')
    expect(manifest.exportVersion).toBe(1)
    expect(manifest.rowCounts['family.members']).toBe(1)
    expect(manifest.rowCounts['meal_plans']).toBe(1)
    expect(manifest.rowCounts['recipes']).toBe(1)
    expect(manifest.rowCounts['documents']).toBe(1)

    // The zip was written as base64 to the document directory.
    const written = mockFsWrites[uri]
    expect(typeof written).toBe('string')
    expect(written.length).toBeGreaterThan(0)

    // Round-trip: open the written archive and verify it contains the
    // expected entries.
    const buf = Buffer.from(written, 'base64')
    const zip = await JSZip.loadAsync(buf)
    expect(zip.file('family.json')).not.toBeNull()
    expect(zip.file('meal_plans.json')).not.toBeNull()
    expect(zip.file('recipes.json')).not.toBeNull()
    expect(zip.file('MANIFEST.json')).not.toBeNull()
    expect(zip.file('README.md')).not.toBeNull()
    expect(zip.file('audit_log.json')).not.toBeNull()
    expect(zip.file('documents/m-1/report.pdf')).not.toBeNull()

    // family.json contains the (decrypted) profile data.
    const familyJson = await zip.file('family.json')!.async('string')
    const family = JSON.parse(familyJson)
    expect(family.familyName).toBe('TestFamily')
    expect(family.members).toHaveLength(1)
    expect(family.members[0].name).toBe('Carlos')

    // Manifest row counts inside the zip match the in-memory manifest.
    const manifestInside = JSON.parse(await zip.file('MANIFEST.json')!.async('string'))
    expect(manifestInside.rowCounts['family.members']).toBe(1)
  })
})
