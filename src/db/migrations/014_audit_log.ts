// Migration 014 — Audit log table.
//
// Implements the persistent record of privacy-relevant events needed to defend
// accountability (RGPD Art. 5.2), satisfy breach-notification timelines
// (Art. 33), and support data-subject access requests (Art. 15).
//
// Column policy:
//   - `payload_enc` holds an AES-GCM ciphertext of a JSON-stringified object
//     containing the per-event details (memberId, docId, counts, etc.). The
//     same master key as the rest of the field-level encryption is used —
//     `enc:v1:` sentinel is omitted because every row is encrypted (no need
//     for a discriminator), saving 7 bytes per row.
//   - `ts`, `event_type`, `actor`, `app_version` are plaintext on purpose:
//     regulators must be able to enumerate event categories without the
//     master key when responding to an Art. 33 inquiry.
//
// The table is wiped by the Art. 17 erasure handler — the data subject's
// right to erasure prevails over Art. 30 ROPA for their own data. The
// controller-side ROPA is maintained externally.
export const migration014 = `
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  event_type  TEXT NOT NULL,
  actor       TEXT NOT NULL,
  payload_enc TEXT NOT NULL,
  app_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts    ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event_type);
`
