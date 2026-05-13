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
    for (let i = 0; i < n; i++) arr[i] = i + 1
    return arr
  },
}))

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(async (k: string, v: string) => {
      memAsyncStorage[k] = v
    }),
    getItem: jest.fn(async (k: string) => memAsyncStorage[k] ?? null),
    removeItem: jest.fn(async (k: string) => {
      delete memAsyncStorage[k]
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      for (const k of keys) delete memAsyncStorage[k]
    }),
    clear: jest.fn(async () => {
      for (const k of Object.keys(memAsyncStorage)) delete memAsyncStorage[k]
    }),
  },
}))

const mockFsDeleted: string[] = []
const mockFsDocDir = '/tmp/fake-doc-dir/'
const mockFsListing: Record<string, string[]> = { [mockFsDocDir]: ['nutri_familia_2026.md', 'other.txt'] }

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/fake-doc-dir/',
  deleteAsync: jest.fn(async (path: string) => {
    mockFsDeleted.push(path)
  }),
  readDirectoryAsync: jest.fn(async (path: string) => mockFsListing[path] ?? []),
}))

// In-memory DB shaped just enough for the erasure flow + audit log.
type AuditRow = {
  id: number
  ts: number
  event_type: string
  actor: string
  payload_enc: string
  app_version: string
}
const mockAuditRows: AuditRow[] = []
let mockAuditNextId = 1
const mockTableRowCounts: Record<string, number> = {
  inventory_items: 3,
  recipes: 5,
  meal_plans: 7,
  school_menu_entries: 2,
  scan_history: 4,
  grocery_items: 6,
  member_memories: 8,
  doc_chunks: 12,
  conversation_summaries: 1,
  member_index: 2,
  retailer_connections: 0,
  usda_cache: 0,
}

const mockDatabase = {
  async runAsync(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    if (sql.startsWith('INSERT INTO audit_log')) {
      const [ts, event_type, actor, payload_enc, app_version] = params as [
        number, string, string, string, string,
      ]
      mockAuditRows.push({ id: mockAuditNextId++, ts, event_type, actor, payload_enc, app_version })
      return { changes: 1 }
    }
    if (sql.startsWith('DELETE FROM audit_log')) {
      const c = mockAuditRows.length
      mockAuditRows.length = 0
      return { changes: c }
    }
    const m = /^DELETE FROM (\w+)$/.exec(sql)
    if (m) {
      const table = m[1]
      const count = mockTableRowCounts[table] ?? 0
      mockTableRowCounts[table] = 0
      return { changes: count }
    }
    throw new Error('Unsupported runAsync in fake: ' + sql)
  },
  async getAllAsync<T>(_sql: string): Promise<T[]> {
    return [] as T[]
  },
}

const mockCloseDatabaseCalls = { count: 0 }

jest.mock('../../db/database', () => ({
  getDatabase: async () => mockDatabase,
  closeDatabase: async () => {
    mockCloseDatabaseCalls.count++
  },
}))

import { eraseAllUserData } from '../../services/dataErasure'

describe('dataErasure.eraseAllUserData', () => {
  beforeEach(() => {
    // Reset all mock state.
    for (const k of Object.keys(memSecureStore)) delete memSecureStore[k]
    for (const k of Object.keys(memAsyncStorage)) delete memAsyncStorage[k]
    mockFsDeleted.length = 0
    mockAuditRows.length = 0
    mockAuditNextId = 1
    mockCloseDatabaseCalls.count = 0
    for (const k of Object.keys(mockTableRowCounts)) mockTableRowCounts[k] = 1
    mockSeedSecureStore()
  })

  function mockSeedSecureStore() {
    // Pretend the master key already exists (32 bytes encoded).
    memSecureStore['nutri_master_key_v1'] = Buffer.alloc(32, 1).toString('base64')
  }

  it('clears every SQLite table, AsyncStorage key, FileSystem path, and the master key', async () => {
    // Seed AsyncStorage with a real app key + one unrelated key. The
    // exact key names come from `src/services/storageKeys.ts`.
    memAsyncStorage['family_profiles'] = '[...]'
    memAsyncStorage['family_name'] = 'Test family'
    memAsyncStorage['sp_quota_cache_v2'] = '{...}'
    memAsyncStorage['nutri_consent_v1'] = '{...}'
    memAsyncStorage['some_other_unrelated_key'] = 'KEEP THIS'

    const result = await eraseAllUserData()

    // 12 SQLite tables (9 original + member_index + retailer_connections + usda_cache).
    expect(Object.keys(result.dbRowsCleared).length).toBe(12)
    expect(result.dbRowsCleared.member_memories).toBe(1)
    expect(result.dbRowsCleared.member_index).toBe(1)

    // AsyncStorage: 16 app keys cleared, the unrelated one preserved.
    expect(result.asyncStorageKeysCleared).toBe(16)
    expect(memAsyncStorage['some_other_unrelated_key']).toBe('KEEP THIS')
    expect(memAsyncStorage['family_profiles']).toBeUndefined()
    expect(memAsyncStorage['family_name']).toBeUndefined()
    expect(memAsyncStorage['nutri_consent_v1']).toBeUndefined()

    // FileSystem: 3 standard subtrees + 1 export markdown.
    expect(result.fileSystemPathsCleared).toContain('/tmp/fake-doc-dir/profile-documents/')
    expect(result.fileSystemPathsCleared).toContain('/tmp/fake-doc-dir/avatars/')
    expect(result.fileSystemPathsCleared).toContain('/tmp/fake-doc-dir/react-native-executorch/')
    expect(result.exportMarkdownsCleared).toBe(1)
    expect(mockFsDeleted).toContain('/tmp/fake-doc-dir/nutri_familia_2026.md')

    // Database closed.
    expect(mockCloseDatabaseCalls.count).toBe(1)

    // Master key deleted (and a NEW one regenerated by the final
    // recordAuditEvent → ensureKey roundtrip, so the secure store should
    // contain a fresh key by the end).
    expect(result.masterKeyDeleted).toBe(true)
    expect(memSecureStore['nutri_master_key_v1']).toBeDefined()

    // Audit log: started + completed events, but the table was wiped in
    // between — so only the COMPLETED event should remain in mockAuditRows
    // (the started one was deleted along with the rest of the table).
    expect(mockAuditRows).toHaveLength(1)
    expect(mockAuditRows[0].event_type).toBe('erasure_completed')
    expect(mockAuditRows[0].actor).toBe('system')

    // No partial failures.
    expect(result.partialFailures).toEqual([])
  })

  it('continues through later phases even if one phase fails', async () => {
    // Force AsyncStorage.multiRemove to throw once.
    const AsyncStorage = require('@react-native-async-storage/async-storage').default
    AsyncStorage.multiRemove.mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    const result = await eraseAllUserData()

    // The failure is recorded but the rest of the erasure still ran.
    expect(result.partialFailures).toContain('async_storage')
    expect(result.asyncStorageKeysCleared).toBe(0)
    // FileSystem and SecureStore still cleared.
    expect(result.fileSystemPathsCleared.length).toBeGreaterThan(0)
    expect(result.masterKeyDeleted).toBe(true)
  })

  it('records erasure_started BEFORE wiping and erasure_completed AFTER', async () => {
    const startedEvents: number[] = []
    const completedEvents: number[] = []
    // We can't intercept the recordAuditEvent call directly here, but
    // we can verify the FINAL state: started is wiped, completed remains.
    await eraseAllUserData()
    for (const r of mockAuditRows) {
      if (r.event_type === 'erasure_started') startedEvents.push(r.id)
      if (r.event_type === 'erasure_completed') completedEvents.push(r.id)
    }
    expect(startedEvents).toHaveLength(0) // wiped along with the rest
    expect(completedEvents).toHaveLength(1) // landed in the fresh table
  })
})
