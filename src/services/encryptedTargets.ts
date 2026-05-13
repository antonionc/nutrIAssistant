// Declarative registry of every encrypted blob the app persists.
//
// Adding a new encrypted column / file / AsyncStorage field means adding
// a row here — that's it. The rotation flow (`keyRotation.ts`) iterates
// this registry instead of hard-coding table names + flags scattered
// across the function body. Future audits (e.g. "list every place that
// holds Art. 9 data") have a single grep target.
//
// On the `enc:v1:` sentinel: most ciphertext blobs in this codebase
// carry an explicit `enc:v1:` prefix so a reader can distinguish
// legacy plaintext from ciphertext during migration. A few callers
// chose to omit it because the entire column / file is by definition
// ciphertext (audit_log.payload_enc, the doc_chunks.embedding base64
// blob, the .pdf.enc file body). The `usesPrefix` flag captures this
// per-target so the rotation engine handles both correctly.

export type EncryptedTargetKind = 'db_text' | 'db_bytes' | 'fs_bytes'

export interface EncryptedTarget {
  /** Logical name for logs / audit payloads. */
  name: string
  /** What kind of storage this target lives in. */
  kind: EncryptedTargetKind
  /** SQLite table (for `db_*` kinds). */
  table?: string
  /** SQLite column (for `db_*` kinds). */
  column?: string
  /** Whether the on-disk value carries the `enc:v1:` sentinel. */
  usesPrefix: boolean
}

export const ENC_PREFIX = 'enc:v1:'

// Columns / files the master-key rotation must visit. The order does not
// matter for correctness but keeps the rotation log easier to scan when
// debugging: by-table-then-column matches how a DB reader would inspect.
export const ENCRYPTED_TARGETS: readonly EncryptedTarget[] = [
  { name: 'member_memories.encrypted_text',          kind: 'db_text',  table: 'member_memories',          column: 'encrypted_text',     usesPrefix: false },
  { name: 'doc_chunks.encrypted_text',               kind: 'db_text',  table: 'doc_chunks',               column: 'encrypted_text',     usesPrefix: false },
  { name: 'doc_chunks.embedding',                    kind: 'db_bytes', table: 'doc_chunks',               column: 'embedding',          usesPrefix: false },
  { name: 'conversation_summaries.encrypted_summary',kind: 'db_text',  table: 'conversation_summaries',   column: 'encrypted_summary',  usesPrefix: false },
  { name: 'audit_log.payload_enc',                   kind: 'db_text',  table: 'audit_log',                column: 'payload_enc',        usesPrefix: false },
] as const

// Note: `family_profiles` (AsyncStorage JSON blob) and `.pdf.enc`
// (FileSystem files) are NOT in this list because they need bespoke
// traversal (walking nested objects / enumerating directories). The
// rotation engine handles them in dedicated helpers; this registry
// covers the homogeneous SQL columns only.
