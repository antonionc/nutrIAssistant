import * as FileSystem from 'expo-file-system/legacy'
import * as DocumentPicker from 'expo-document-picker'
import { ProfileDocument, DocumentCategory } from '../types/profiles'
import { generateId } from '../utils/idUtils'
import { extractPdfText } from '../../modules/expo-pdf-text'
import { generateOnDevice } from './onDeviceLlm'
import { embedTextOrNull } from './embeddings'
import { insertDocChunk, deleteDocChunksForDoc } from './memoryStore'
import { currentLang } from '../utils/locale'
import { logger } from '../utils/logger'
import { writeEncryptedFile, readEncryptedToTemp, isEncryptedPath } from './secureFileStore'
import { recordAuditEvent, pseudonymise } from './auditLog'

const PROFILE_DOCS_PREFIX = 'profile-documents/'
const SUMMARY_MAX_CHARS = 500
const SUMMARY_INPUT_MAX_CHARS = 8000  // truncate huge PDFs before feeding the model

function profileDocsDir(memberId: string): string {
  return `${FileSystem.documentDirectory}${PROFILE_DOCS_PREFIX}${memberId}/`
}

async function ensureDir(memberId: string): Promise<void> {
  if (!FileSystem.documentDirectory) return
  const dir = profileDocsDir(memberId)
  const info = await FileSystem.getInfoAsync(dir)
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
  }
}

export function resolveDocumentUri(filePath: string): string {
  if (filePath.startsWith('file://') || filePath.startsWith('/')) return filePath
  return `${FileSystem.documentDirectory ?? ''}${filePath}`
}

const DOC_SUMMARY_SYSTEM_PROMPT_ES = `/no_think
Eres un asistente médico-nutricional. Resume el siguiente documento clínico/sanitario en español, en máximo 4 frases cortas (máx 500 caracteres en total). Centra el resumen en datos accionables: alergias, intolerancias, condiciones diagnosticadas, restricciones dietéticas, valores de laboratorio fuera de rango, medicación relevante. NO incluyas datos personales identificativos (nombre, fecha exacta, número de historia). Si el documento no contiene información médica clara, responde: "Sin datos clínicos relevantes."`

const DOC_SUMMARY_SYSTEM_PROMPT_EN = `/no_think
You are a medical-nutrition assistant. Summarize the following clinical/health document in English, in at most 4 short sentences (max 500 characters total). Focus the summary on actionable data: allergies, intolerances, diagnosed conditions, dietary restrictions, out-of-range lab values, relevant medication. DO NOT include personally identifying data (name, exact date, record number). If the document contains no clear medical information, reply: "No clinically relevant data."`

// Picks a PDF from the user's files, copies it into the per-member documents
// dir AS AN ENCRYPTED .pdf.enc FILE, and returns a ProfileDocument whose
// `filePath` points to the encrypted blob. Returns null if the user cancels.
// The picker's cache copy of the source PDF is deleted after encryption
// to minimise the plaintext footprint on disk.
export async function pickAndCopyDocument(
  memberId: string,
  category: DocumentCategory = 'lab_report'
): Promise<ProfileDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
  })
  if (result.canceled || !result.assets?.[0]) return null
  const asset = result.assets[0]

  await ensureDir(memberId)
  const id = generateId('doc')
  const filename = asset.name ?? `${id}.pdf`
  const baseRelPath = `${PROFILE_DOCS_PREFIX}${memberId}/${id}.pdf`
  const baseAbs = `${FileSystem.documentDirectory}${baseRelPath}`
  // writeEncryptedFile appends the `.enc` suffix, so the final on-disk
  // path is `<id>.pdf.enc`. We persist that as the `filePath` so every
  // subsequent read knows it's ciphertext without having to probe disk.
  const encAbs = await writeEncryptedFile(asset.uri, baseAbs)
  const relPath = encAbs.replace(FileSystem.documentDirectory ?? '', '')

  // Best-effort: remove the picker's cache copy so the plaintext PDF does
  // not linger after upload. cacheDirectory is volatile but we still wipe
  // it proactively.
  try {
    await FileSystem.deleteAsync(asset.uri, { idempotent: true })
  } catch {
    /* ignored — cache cleanup is best-effort */
  }

  // Audit event. The filename is omitted on purpose: original PDF names
  // routinely embed patient names, dates of birth, or test IDs. The
  // memberId and docId are pseudonymised (SHA256 + salt, truncated to
  // 48 bits) so an attacker with the master key cannot rebuild a
  // who-uploaded-what dictionary from the audit log alone.
  await recordAuditEvent('pdf_uploaded', {
    memberRef: await pseudonymise(memberId),
    docRef: await pseudonymise(id),
    category,
  })

  return {
    id,
    filename,
    filePath: relPath,
    uploadedAt: new Date().toISOString(),
    category,
    aiSummaryStatus: 'pending',
  }
}

// Centralised helper: opens the on-disk file (encrypted or legacy plain)
// and yields a plaintext path the caller can pass to extractPdfText or any
// other native reader. The caller MUST invoke `dispose()` in a `finally`
// block — failure to do so leaves a plaintext PDF in cacheDirectory until
// the OS cleans it.
async function withPlaintextDocument<T>(
  absPath: string,
  body: (plaintextUri: string) => Promise<T>,
): Promise<T> {
  if (!isEncryptedPath(absPath)) {
    // Legacy plaintext install — no decrypt needed, but the boot-time
    // migration in `secureFileStore.migratePlaintextDocumentsToEncrypted`
    // will eventually rewrite these.
    return body(absPath)
  }
  const { tempUri, dispose } = await readEncryptedToTemp(absPath)
  try {
    return await body(tempUri)
  } finally {
    await dispose()
  }
}

// Extracts text from a stored PDF and asks the on-device LLM to produce a
// short summary. Throws if the PDF can't be read or the LLM call fails.
// PDFs at rest are encrypted; we decrypt to a short-lived plaintext file
// in cacheDirectory for the duration of the PDF-text extraction call,
// then delete it via `dispose()`.
export async function summarizeDocument(doc: ProfileDocument): Promise<string> {
  const abs = resolveDocumentUri(doc.filePath)
  const rawText = await withPlaintextDocument(abs, (plaintextUri) => extractPdfText(plaintextUri))
  const lang = currentLang()
  if (!rawText || rawText.trim().length === 0) {
    return lang === 'en' ? 'No clinically relevant data.' : 'Sin datos clínicos relevantes.'
  }
  const truncated = rawText.slice(0, SUMMARY_INPUT_MAX_CHARS)
  const docLabel = lang === 'en' ? 'Document' : 'Documento'
  const userPrompt = `${docLabel} (${doc.filename}):\n\n${truncated}`
  const systemPrompt = lang === 'en' ? DOC_SUMMARY_SYSTEM_PROMPT_EN : DOC_SUMMARY_SYSTEM_PROMPT_ES
  const summary = await generateOnDevice(userPrompt, systemPrompt)
  // Hard cap to protect the system-prompt budget downstream.
  return summary.trim().slice(0, SUMMARY_MAX_CHARS)
}

// Splits raw extracted PDF text into chunks small enough to fit comfortably
// inside the assistant's prompt budget when retrieved later. Sentence-aware:
// breaks on `.`/`?`/`!` so chunks don't slice mid-clause. Output chunks are
// roughly 400-500 chars each.
const CHUNK_TARGET_CHARS = 450
const CHUNK_MIN_CHARS = 80
function chunkPdfText(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return []
  const sentences = cleaned.split(/(?<=[.?!])\s+/)
  const chunks: string[] = []
  let current = ''
  for (const s of sentences) {
    if (current.length + s.length + 1 <= CHUNK_TARGET_CHARS) {
      current = current ? `${current} ${s}` : s
    } else {
      if (current.length >= CHUNK_MIN_CHARS) chunks.push(current)
      // Sentence longer than the target on its own — hard-split on whitespace.
      if (s.length > CHUNK_TARGET_CHARS) {
        for (let i = 0; i < s.length; i += CHUNK_TARGET_CHARS) {
          chunks.push(s.slice(i, i + CHUNK_TARGET_CHARS))
        }
        current = ''
      } else {
        current = s
      }
    }
  }
  if (current.length >= CHUNK_MIN_CHARS) chunks.push(current)
  return chunks
}

// Indexes a PDF for later semantic retrieval: chunks the extracted text,
// embeds each chunk, encrypts both text and embedding, and persists to the
// `doc_chunks` SQLite table. Best-effort — if the embeddings model is not
// loaded, returns 0 rather than throwing so the upload flow still succeeds.
export async function indexDocumentForRetrieval(
  memberId: string,
  doc: ProfileDocument
): Promise<number> {
  const abs = resolveDocumentUri(doc.filePath)
  const rawText = await withPlaintextDocument(abs, (plaintextUri) => extractPdfText(plaintextUri))
  if (!rawText || rawText.trim().length === 0) return 0

  // Replace any old chunks for this doc — re-index is idempotent.
  await deleteDocChunksForDoc(doc.id)

  const chunks = chunkPdfText(rawText.slice(0, SUMMARY_INPUT_MAX_CHARS))
  let inserted = 0
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedTextOrNull(chunks[i])
    if (!embedding) {
      // Embeddings unavailable — bail; partial indexing would mislead retrieval.
      logger.warn('[profileDocuments] embeddings unavailable, skipping indexing')
      return 0
    }
    await insertDocChunk(memberId, doc.id, i, chunks[i], embedding)
    inserted++
  }
  return inserted
}

// Best-effort cleanup; ignores errors so a missing file never blocks state.
export async function deleteDocumentFile(filePath: string): Promise<void> {
  try {
    const abs = resolveDocumentUri(filePath)
    await FileSystem.deleteAsync(abs, { idempotent: true })
  } catch (e) {
    logger.warn('[profileDocuments] deleteDocumentFile failed:', e)
  }
}

// Localized category labels live in src/i18n/{en,es}.ts under documents.categories.
// Use `tr.documents.categories[doc.category]` in components.
