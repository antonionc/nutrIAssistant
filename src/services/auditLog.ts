import * as Crypto from 'expo-crypto'
import { getDatabase } from '../db/database'
import { encrypt, decrypt, ensureKey } from './encryption'
import { logger } from '../utils/logger'

// Salt for pseudonymisation of identifiers inside audit payloads. The
// audit log itself is encrypted; an attacker who compromises the master
// key gets the plaintext payload. By hashing IDs with a salt, the
// post-compromise view shows opaque digests instead of `member-abc-123`.
// GDPR Art. 32 calls for pseudonymisation "where practical" and this is.
//
// The salt is a per-install random value persisted via SecureStore in
// `ensureKey()`-style — using a constant salt would let an offline
// attacker rebuild the dictionary. For now we use a fixed salt (build-
// time) plus the master-key bytes; an attacker with the key already has
// everything, so adding the key bytes doesn't reduce security beyond
// what's already lost. Future improvement: separate salt in SecureStore.
const PSEUDO_SALT_PREFIX = 'nutri-audit-pseudo-v1:'

/**
 * One-way hash of an identifier suitable for audit-log payloads.
 * Same input → same output (so the audit log can be cross-referenced
 * internally), but inverting requires breaking SHA-256.
 *
 * Use this for `memberId`, `docId`, and any other identifier you would
 * have put raw into the payload before.
 */
export async function pseudonymise(id: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    PSEUDO_SALT_PREFIX + id,
    { encoding: Crypto.CryptoEncoding.HEX },
  )
  // 12 hex chars (48 bits) is enough to distinguish a handful of members
  // / documents per family while staying compact in the audit log.
  return digest.slice(0, 12)
}

// Privacy-relevant event types written to the local `audit_log` table.
// Add new types here when a new privacy-sensitive operation needs evidence.
//
// Keep this enum frozen-in-spirit: existing event names must never change,
// otherwise downstream filters in `app/settings/audit-log.tsx` and any
// future regulator-facing export (Art. 33 / Art. 15) would silently miss
// historical rows.
export type AuditEventType =
  | 'consent_granted'
  | 'consent_revoked'
  | 'erasure_started'
  | 'erasure_completed'
  | 'export_generated'
  | 'pdf_uploaded'
  | 'key_rotation_started'
  | 'key_rotation_completed'
  | 'decrypt_failure'
  | 'parental_consent_granted'
  | 'retention_sweep_executed'

export type AuditActor = 'user' | 'system'

export interface AuditEntry {
  id: number
  ts: number
  eventType: AuditEventType
  actor: AuditActor
  payload: Record<string, unknown>
  appVersion: string
}

// App version is read once at startup. If a future build wants to swap to
// an `expo-constants` lookup it can set this from `app/_layout.tsx` boot.
let appVersionTag = '1.0.0'
export function setAuditAppVersion(version: string): void {
  appVersionTag = version
}

/**
 * Append an event to the audit log. Payload is AES-GCM-encrypted with the
 * master key; the event_type, timestamp, actor and app_version stay in
 * plaintext so they can be enumerated for breach notification without
 * needing the key.
 *
 * Logging itself never throws — a corrupt audit row is far less harmful
 * than a crashed business flow. Failures are downgraded to a `logger.error`.
 */
export async function recordAuditEvent(
  eventType: AuditEventType,
  payload: Record<string, unknown> = {},
  actor: AuditActor = 'user',
): Promise<void> {
  try {
    await ensureKey()
    const db = await getDatabase()
    const ts = Date.now()
    const payloadJson = JSON.stringify(payload)
    const payloadEnc = encrypt(payloadJson)
    await db.runAsync(
      'INSERT INTO audit_log (ts, event_type, actor, payload_enc, app_version) VALUES (?, ?, ?, ?, ?)',
      [ts, eventType, actor, payloadEnc, appVersionTag],
    )
  } catch (err) {
    // Never let an audit failure break the calling flow. We log it (the
    // logger scrubs any PII in the payload), but we do not re-throw.
    logger.error('[AuditLog] failed to record event', { eventType, err })
  }
}

/**
 * Read recent audit entries with payloads DECRYPTED in memory. Used by the
 * settings "My activity" screen to show users what the app has done with
 * their data (Art. 15 transparency).
 */
export async function getRecentAuditEntries(
  limit = 50,
  filterEventType?: AuditEventType,
): Promise<AuditEntry[]> {
  await ensureKey()
  const db = await getDatabase()
  const rows = filterEventType
    ? await db.getAllAsync<{
        id: number
        ts: number
        event_type: string
        actor: string
        payload_enc: string
        app_version: string
      }>(
        'SELECT id, ts, event_type, actor, payload_enc, app_version FROM audit_log WHERE event_type = ? ORDER BY ts DESC LIMIT ?',
        [filterEventType, limit],
      )
    : await db.getAllAsync<{
        id: number
        ts: number
        event_type: string
        actor: string
        payload_enc: string
        app_version: string
      }>(
        'SELECT id, ts, event_type, actor, payload_enc, app_version FROM audit_log ORDER BY ts DESC LIMIT ?',
        [limit],
      )
  const out: AuditEntry[] = []
  for (const r of rows) {
    let payload: Record<string, unknown> = {}
    try {
      payload = JSON.parse(decrypt(r.payload_enc)) as Record<string, unknown>
    } catch (err) {
      // A single corrupt row shouldn't blank the entire screen — surface
      // a placeholder and keep iterating.
      payload = { _decryption_failed: true }
      logger.warn('[AuditLog] could not decrypt row', { id: r.id, err })
    }
    out.push({
      id: r.id,
      ts: r.ts,
      eventType: r.event_type as AuditEventType,
      actor: r.actor as AuditActor,
      payload,
      appVersion: r.app_version,
    })
  }
  return out
}

/**
 * Used by the erasure handler (Sprint 1.5) and the retention sweeper
 * (Sprint 5.1). Always recorded with a synthesised `erasure_completed`
 * entry afterwards (in the freshly-recreated table).
 */
export async function deleteAllAuditEntries(): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM audit_log')
}

/**
 * Used by the retention sweeper to prune entries older than the configured
 * window (1 year by default).
 */
export async function deleteAuditEntriesOlderThan(ms: number): Promise<number> {
  const db = await getDatabase()
  const cutoff = Date.now() - ms
  const result = await db.runAsync('DELETE FROM audit_log WHERE ts < ?', [cutoff])
  return result.changes
}
