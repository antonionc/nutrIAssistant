import JSZip from 'jszip'
import * as FileSystem from 'expo-file-system/legacy'
import { getDatabase } from '../db/database'
import { ensureKey, decrypt } from './encryption'
import { loadProfiles, loadFamilyName } from '../modules/profiles/profileStorage'
import { listMemberMemories, getDocChunksForMember } from './memoryStore'
import { getRecentAuditEntries, recordAuditEvent } from './auditLog'
import { isEncryptedPath, readEncryptedToTemp } from './secureFileStore'
import { logger } from '../utils/logger'

// GDPR Art. 15 right of access — emit a single .zip the data subject can
// open in any tool, containing a complete, DECRYPTED dump of every piece of
// data the app holds about them on the device. Markdown/JSON inside the
// archive plus the original PDF documents.
//
// Compared to the legacy `exportFamilyToMarkdown`, this export covers:
//   - the full member profile (not just the headline fields),
//   - meal plans, recipes (favorites + cached), inventory, grocery list,
//     scan history, school menu entries,
//   - member memories (decrypted),
//   - PDF document chunks (decrypted),
//   - conversation summaries (decrypted),
//   - the audit log (decrypted),
//   - the source PDF files themselves (still plaintext on disk in v1 —
//     Sprint 2.1 will move them behind encryption, the export then reads
//     the .enc file and writes the decrypted PDF into the archive).
//
// `retailer_connections` is intentionally redacted: OAuth tokens would
// give the receiver of the export full access to the user's retailer
// account, which exceeds what Art. 15 requires.
//
// Memory note: `dumpProfileDocuments` streams the source PDFs file-by-
// file so we never hold more than one PDF in memory at our own layer.
// However, `JSZip.generateAsync` accumulates every entry in memory
// before emitting the final blob — that is a library limitation, not
// something this function controls. Practical ceiling is ~200 MB of
// uncompressed payload on a typical RN device; users above that would
// benefit from a streaming-zip native module (`react-native-zip-archive`)
// which is out of scope here.

const MANIFEST_VERSION = 1

interface ExportResultManifest {
  exportVersion: number
  generatedAt: string
  appVersion: string
  rowCounts: Record<string, number>
}

async function dumpDbTable(zip: JSZip, table: string): Promise<number> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table}`)
  zip.file(`${table}.json`, JSON.stringify(rows, null, 2))
  return rows.length
}

async function dumpMemberMemories(zip: JSZip, memberIds: string[]): Promise<number> {
  const all: Array<{ memberId: string; entries: unknown[] }> = []
  let total = 0
  for (const memberId of memberIds) {
    const entries = await listMemberMemories(memberId)
    all.push({ memberId, entries })
    total += entries.length
  }
  zip.file('member_memories.json', JSON.stringify(all, null, 2))
  return total
}

async function dumpDocChunks(zip: JSZip, memberIds: string[]): Promise<number> {
  const all: Array<{ memberId: string; chunks: unknown[] }> = []
  let total = 0
  for (const memberId of memberIds) {
    const chunks = await getDocChunksForMember(memberId)
    // Strip the embedding array — it's large and not regulator-useful;
    // keep just the chunk text + metadata.
    const slim = chunks.map((c) => ({
      id: c.id,
      docId: c.docId,
      chunkIndex: c.chunkIndex,
      text: c.text,
      createdAt: c.createdAt,
    }))
    all.push({ memberId, chunks: slim })
    total += chunks.length
  }
  zip.file('doc_chunks.json', JSON.stringify(all, null, 2))
  return total
}

async function dumpConversationSummaries(zip: JSZip): Promise<number> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<{
    id: string
    member_id: string
    encrypted_summary: string
    turns_covered: number
    created_at: string
  }>('SELECT id, member_id, encrypted_summary, turns_covered, created_at FROM conversation_summaries')
  const decrypted = rows.map((r) => {
    let summary: string
    try {
      summary = decrypt(r.encrypted_summary)
    } catch (err) {
      summary = '[decryption failed]'
      logger.warn('[Export] could not decrypt conversation summary', { id: r.id, err })
    }
    return {
      id: r.id,
      memberId: r.member_id,
      summary,
      turnsCovered: r.turns_covered,
      createdAt: r.created_at,
    }
  })
  zip.file('conversation_summaries.json', JSON.stringify(decrypted, null, 2))
  return decrypted.length
}

async function dumpAuditLog(zip: JSZip): Promise<number> {
  // 10_000 is well above the typical row count for a single device. If a
  // user manages to exceed this, the export still succeeds — we just cap
  // the slice (and the user can request another export afterwards).
  const entries = await getRecentAuditEntries(10_000)
  zip.file('audit_log.json', JSON.stringify(entries, null, 2))
  return entries.length
}

async function dumpProfileDocuments(zip: JSZip, memberIds: string[]): Promise<number> {
  let count = 0
  const base = FileSystem.documentDirectory ?? ''
  for (const memberId of memberIds) {
    const dir = `${base}profile-documents/${memberId}/`
    let files: string[] = []
    try {
      files = await FileSystem.readDirectoryAsync(dir)
    } catch {
      // Member has never uploaded a document — directory does not exist.
      continue
    }
    for (const name of files) {
      try {
        const sourcePath = dir + name
        let zipPath = `documents/${memberId}/${name}`
        let base64Data: string
        if (isEncryptedPath(sourcePath)) {
          // Encrypted PDF: decrypt to a temp file, read the plaintext,
          // strip the .enc suffix so the archive contains a readable PDF.
          const { tempUri, dispose } = await readEncryptedToTemp(sourcePath)
          try {
            base64Data = await FileSystem.readAsStringAsync(tempUri, {
              encoding: FileSystem.EncodingType.Base64,
            })
          } finally {
            await dispose()
          }
          zipPath = `documents/${memberId}/${name.replace(/\.enc$/, '')}`
        } else {
          // Legacy plaintext PDF — read directly.
          base64Data = await FileSystem.readAsStringAsync(sourcePath, {
            encoding: FileSystem.EncodingType.Base64,
          })
        }
        zip.file(zipPath, base64Data, { base64: true })
        count++
      } catch (err) {
        logger.warn('[Export] could not read document file', { memberId, name, err })
      }
    }
  }
  return count
}

function buildReadme(manifest: ExportResultManifest): string {
  return [
    '# NutrIAssistant — Your data export (GDPR Art. 15)',
    '',
    `Generated: ${manifest.generatedAt}`,
    `App version: ${manifest.appVersion}`,
    `Export schema version: ${manifest.exportVersion}`,
    '',
    '## What\'s inside',
    '',
    '- `family.json` — your family name and member profiles, with sensitive fields decrypted.',
    '- `meal_plans.json`, `recipes.json`, `inventory.json`, `grocery_items.json`,',
    '  `school_menu_entries.json`, `scan_history.json` — your usage history.',
    '- `member_memories.json`, `conversation_summaries.json` — what the AI',
    '  assistant has remembered about you (decrypted).',
    '- `doc_chunks.json` — the AI-readable extracted text of every PDF you uploaded.',
    '- `documents/<memberId>/<file>.pdf` — the original PDF files.',
    '- `audit_log.json` — every privacy-relevant operation the app has performed.',
    '- `MANIFEST.json` — machine-readable index with row counts.',
    '',
    '## What is NOT included',
    '',
    '- Retailer OAuth tokens (omitted on purpose — including them would give the',
    '  bearer of this archive access to your shopping accounts).',
    '- Cached responses from third-party catalog APIs that contain no personal data.',
    '',
    '## Format',
    '',
    'JSON files are UTF-8 encoded. Timestamps are ISO 8601. PDFs are the',
    'original files you uploaded.',
    '',
    '## Questions',
    '',
    'Contact hola@nutriassistant.ai for any question about this export.',
  ].join('\n')
}

export interface ExportSummary {
  uri: string
  manifest: ExportResultManifest
}

/**
 * Build the Art. 15 export and write it to the document directory. Returns
 * the local URI plus the manifest so callers can show row counts to the
 * user before triggering `expo-sharing`.
 *
 * Single best-effort pass: a failure in one section is logged but does not
 * abort the rest of the export. Sections that failed appear in the
 * manifest with rowCount=-1.
 */
export async function exportAllUserData(appVersion: string): Promise<ExportSummary> {
  await ensureKey()
  const zip = new JSZip()
  const rowCounts: Record<string, number> = {}

  // ── Profiles + family name (already decrypted by loadProfiles) ──────────
  try {
    const familyName = await loadFamilyName()
    const members = await loadProfiles()
    zip.file('family.json', JSON.stringify({ familyName, members }, null, 2))
    rowCounts['family.members'] = members.length

    const memberIds = members.map((m) => m.id)

    // ── DB tables that contain no encrypted columns ───────────────────────
    for (const t of [
      'meal_plans',
      'recipes',
      'inventory_items',
      'grocery_items',
      'school_menu_entries',
      'scan_history',
    ]) {
      try {
        rowCounts[t] = await dumpDbTable(zip, t)
      } catch (err) {
        logger.error('[Export] failed to dump table', { table: t, err })
        rowCounts[t] = -1
      }
    }

    // ── Encrypted tables: decrypt in memory before writing ────────────────
    try {
      rowCounts['member_memories'] = await dumpMemberMemories(zip, memberIds)
    } catch (err) {
      logger.error('[Export] failed to dump member_memories', { err })
      rowCounts['member_memories'] = -1
    }

    try {
      rowCounts['doc_chunks'] = await dumpDocChunks(zip, memberIds)
    } catch (err) {
      logger.error('[Export] failed to dump doc_chunks', { err })
      rowCounts['doc_chunks'] = -1
    }

    try {
      rowCounts['conversation_summaries'] = await dumpConversationSummaries(zip)
    } catch (err) {
      logger.error('[Export] failed to dump conversation_summaries', { err })
      rowCounts['conversation_summaries'] = -1
    }

    try {
      rowCounts['audit_log'] = await dumpAuditLog(zip)
    } catch (err) {
      logger.error('[Export] failed to dump audit_log', { err })
      rowCounts['audit_log'] = -1
    }

    try {
      rowCounts['documents'] = await dumpProfileDocuments(zip, memberIds)
    } catch (err) {
      logger.error('[Export] failed to dump documents', { err })
      rowCounts['documents'] = -1
    }
  } catch (err) {
    logger.error('[Export] fatal error before manifest write', { err })
  }

  const manifest: ExportResultManifest = {
    exportVersion: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    appVersion,
    rowCounts,
  }
  zip.file('MANIFEST.json', JSON.stringify(manifest, null, 2))
  zip.file('README.md', buildReadme(manifest))

  const base64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' })
  const uri = `${FileSystem.documentDirectory}nutri_export_${Date.now()}.zip`
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  })

  // Audit the export AFTER it's written successfully. The row count summary
  // is small and contains no PII, so it's safe to put in the payload.
  const totalBytes = base64.length
  await recordAuditEvent('export_generated', { rowCounts, bytes: totalBytes })

  return { uri, manifest }
}
