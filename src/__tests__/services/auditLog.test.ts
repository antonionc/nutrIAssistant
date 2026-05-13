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
  getRandomBytes: (n: number) => {
    const arr = new Uint8Array(n)
    for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256)
    return arr
  },
}))

// In-memory SQLite-shaped fake for the audit_log table only.
type Row = {
  id: number
  ts: number
  event_type: string
  actor: string
  payload_enc: string
  app_version: string
}

const mockDb = (() => {
  const rows: Row[] = []
  let nextId = 1
  return {
    rows,
    reset() {
      rows.length = 0
      nextId = 1
    },
    async runAsync(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
      if (sql.startsWith('INSERT INTO audit_log')) {
        const [ts, event_type, actor, payload_enc, app_version] = params as [
          number, string, string, string, string,
        ]
        rows.push({ id: nextId++, ts, event_type, actor, payload_enc, app_version })
        return { changes: 1 }
      }
      if (sql.startsWith('DELETE FROM audit_log WHERE ts <')) {
        const [cutoff] = params as [number]
        const before = rows.length
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].ts < cutoff) rows.splice(i, 1)
        }
        return { changes: before - rows.length }
      }
      if (sql.startsWith('DELETE FROM audit_log')) {
        const c = rows.length
        rows.length = 0
        return { changes: c }
      }
      throw new Error('Unsupported runAsync SQL in audit_log test fake: ' + sql)
    },
    async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      if (sql.includes('WHERE event_type = ?')) {
        const [type, limit] = params as [string, number]
        return rows
          .filter((r) => r.event_type === type)
          .sort((a, b) => b.ts - a.ts)
          .slice(0, limit) as unknown as T[]
      }
      if (sql.includes('ORDER BY ts DESC LIMIT')) {
        const [limit] = params as [number]
        return rows
          .slice()
          .sort((a, b) => b.ts - a.ts)
          .slice(0, limit) as unknown as T[]
      }
      throw new Error('Unsupported getAllAsync SQL: ' + sql)
    },
  }
})()

jest.mock('../../db/database', () => ({
  getDatabase: async () => mockDb,
}))

import {
  recordAuditEvent,
  getRecentAuditEntries,
  deleteAllAuditEntries,
  deleteAuditEntriesOlderThan,
  setAuditAppVersion,
} from '../../services/auditLog'
import { ensureKey, _resetKeyCacheForTests } from '../../services/encryption'

describe('auditLog', () => {
  beforeEach(async () => {
    _resetKeyCacheForTests()
    for (const k of Object.keys(memSecureStore)) delete memSecureStore[k]
    mockDb.reset()
    setAuditAppVersion('test-1.0.0')
    await ensureKey()
  })

  it('records an event with encrypted payload and plaintext metadata', async () => {
    await recordAuditEvent('erasure_started', { reason: 'user_request' })
    expect(mockDb.rows).toHaveLength(1)
    const row = mockDb.rows[0]
    expect(row.event_type).toBe('erasure_started')
    expect(row.actor).toBe('user')
    expect(row.app_version).toBe('test-1.0.0')
    // payload_enc is base64 ciphertext — must NOT contain the plaintext value
    expect(row.payload_enc).not.toContain('user_request')
    expect(row.payload_enc).not.toContain('reason')
  })

  it('roundtrips a recorded event back to plaintext on read', async () => {
    await recordAuditEvent('export_generated', { rowCounts: { meal_plans: 7 }, bytes: 1234 })
    const entries = await getRecentAuditEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].eventType).toBe('export_generated')
    expect(entries[0].payload).toEqual({ rowCounts: { meal_plans: 7 }, bytes: 1234 })
  })

  it('respects the limit and orders by ts DESC', async () => {
    await recordAuditEvent('consent_granted', { toggle: 'health' })
    await new Promise((r) => setTimeout(r, 5))
    await recordAuditEvent('consent_granted', { toggle: 'ai' })
    await new Promise((r) => setTimeout(r, 5))
    await recordAuditEvent('consent_revoked', { toggle: 'documents' })
    const entries = await getRecentAuditEntries(2)
    expect(entries).toHaveLength(2)
    // Most-recent first
    expect(entries[0].eventType).toBe('consent_revoked')
    expect(entries[1].eventType).toBe('consent_granted')
  })

  it('filters by event_type', async () => {
    await recordAuditEvent('consent_granted', {})
    await recordAuditEvent('export_generated', {})
    await recordAuditEvent('consent_granted', {})
    const entries = await getRecentAuditEntries(10, 'consent_granted')
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.eventType === 'consent_granted')).toBe(true)
  })

  it('records actor=system when explicitly requested', async () => {
    await recordAuditEvent('retention_sweep_executed', { deletedCounts: { scan_history: 5 } }, 'system')
    expect(mockDb.rows[0].actor).toBe('system')
  })

  it('does not throw when payload contains awkward shapes', async () => {
    await expect(
      recordAuditEvent('decrypt_failure', { err: new Error('boom'), nested: { a: 1 } }),
    ).resolves.toBeUndefined()
  })

  it('deleteAllAuditEntries empties the table', async () => {
    await recordAuditEvent('consent_granted', {})
    await recordAuditEvent('consent_granted', {})
    expect(mockDb.rows).toHaveLength(2)
    await deleteAllAuditEntries()
    expect(mockDb.rows).toHaveLength(0)
  })

  it('deleteAuditEntriesOlderThan removes only rows older than the cutoff', async () => {
    // Manually inject rows with controlled timestamps.
    const now = Date.now()
    mockDb.rows.push(
      { id: 1, ts: now - 10_000, event_type: 'consent_granted', actor: 'user', payload_enc: 'x', app_version: 'v' },
      { id: 2, ts: now - 1_000, event_type: 'consent_granted', actor: 'user', payload_enc: 'x', app_version: 'v' },
    )
    const deleted = await deleteAuditEntriesOlderThan(5_000)
    expect(deleted).toBe(1)
    expect(mockDb.rows).toHaveLength(1)
    expect(mockDb.rows[0].id).toBe(2)
  })
})
