import AsyncStorage from '@react-native-async-storage/async-storage'
import { getDatabase } from '../db/database'
import { recordAuditEvent, deleteAuditEntriesOlderThan } from './auditLog'
import { logger } from '../utils/logger'

// Retention sweeper — implements Art. 5.1.e (storage limitation). Runs
// at most once per day from `app/_layout.tsx`. Idempotent: a second run
// in the same calendar day is a no-op (cheap AsyncStorage read).
//
// All deletions are best-effort; one failing table does not prevent the
// rest. The summary of counts goes to the audit log as a single
// `retention_sweep_executed` row.

const KEY_LAST_SWEEP = 'nutri_retention_last_sweep'

const DAY = 24 * 60 * 60 * 1000

interface RetentionRule {
  table: string
  column: string
  // ISO date threshold ("date < ?") or epoch-ms threshold ("ts < ?")
  format: 'iso_date' | 'epoch_ms'
  retentionDays: number
}

// Source of truth for retention policies. Keep in sync with the Privacy
// Policy §5 and ROPA. Adding a new table here is enough — no other code
// path needs to change.
const RULES: RetentionRule[] = [
  { table: 'scan_history', column: 'timestamp', format: 'iso_date', retentionDays: 180 },
  { table: 'meal_plans', column: 'date', format: 'iso_date', retentionDays: 90 },
  { table: 'conversation_summaries', column: 'created_at', format: 'iso_date', retentionDays: 30 },
]

/**
 * Returns true when a sweep has already run today (local solar day).
 * Cheap — single AsyncStorage read.
 */
async function sweptToday(): Promise<boolean> {
  const last = await AsyncStorage.getItem(KEY_LAST_SWEEP)
  if (!last) return false
  const lastDate = new Date(Number(last)).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  return lastDate === today
}

async function deleteWithRule(rule: RetentionRule): Promise<number> {
  const db = await getDatabase()
  const cutoffMs = Date.now() - rule.retentionDays * DAY
  if (rule.format === 'iso_date') {
    const cutoffIso = new Date(cutoffMs).toISOString().slice(0, 10)
    const result = await db.runAsync(
      `DELETE FROM ${rule.table} WHERE ${rule.column} < ?`,
      [cutoffIso],
    )
    return result.changes
  }
  const result = await db.runAsync(
    `DELETE FROM ${rule.table} WHERE ${rule.column} < ?`,
    [cutoffMs],
  )
  return result.changes
}

export async function runRetentionSweep(force = false): Promise<{
  deletedCounts: Record<string, number>
  skipped: boolean
}> {
  if (!force && (await sweptToday())) {
    return { deletedCounts: {}, skipped: true }
  }

  const deletedCounts: Record<string, number> = {}
  for (const rule of RULES) {
    try {
      const deleted = await deleteWithRule(rule)
      deletedCounts[rule.table] = deleted
    } catch (err) {
      logger.error('[Retention] sweep failed for table', { table: rule.table, err })
      deletedCounts[rule.table] = -1
    }
  }

  // Audit log retention is policy-specified to 1 year. Handled
  // separately because the helper already exists in auditLog.ts.
  try {
    deletedCounts['audit_log'] = await deleteAuditEntriesOlderThan(365 * DAY)
  } catch (err) {
    logger.error('[Retention] sweep failed for audit_log', { err })
    deletedCounts['audit_log'] = -1
  }

  await AsyncStorage.setItem(KEY_LAST_SWEEP, String(Date.now()))
  await recordAuditEvent('retention_sweep_executed', { deletedCounts }, 'system')

  return { deletedCounts, skipped: false }
}
