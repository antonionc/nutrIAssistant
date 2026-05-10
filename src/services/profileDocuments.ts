import * as FileSystem from 'expo-file-system/legacy'
import * as DocumentPicker from 'expo-document-picker'
import { ProfileDocument, DocumentCategory } from '../types/profiles'
import { generateId } from '../utils/idUtils'
import { extractPdfText } from '../../modules/expo-pdf-text'
import { generateOnDevice } from './onDeviceLlm'
import { embedTextOrNull } from './embeddings'
import { insertDocChunk, deleteDocChunksForDoc } from './memoryStore'
import { currentLang } from '../utils/locale'

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
// dir, and returns a ProfileDocument with aiSummaryStatus = 'pending'.
// Returns null if the user cancels.
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
  const relPath = `${PROFILE_DOCS_PREFIX}${memberId}/${id}.pdf`
  const destAbs = `${FileSystem.documentDirectory}${relPath}`
  await FileSystem.copyAsync({ from: asset.uri, to: destAbs })

  return {
    id,
    filename,
    filePath: relPath,
    uploadedAt: new Date().toISOString(),
    category,
    aiSummaryStatus: 'pending',
  }
}

// Extracts text from a stored PDF and asks the on-device LLM to produce a
// short summary. Throws if the PDF can't be read or the LLM call fails.
export async function summarizeDocument(doc: ProfileDocument): Promise<string> {
  const abs = resolveDocumentUri(doc.filePath)
  const rawText = await extractPdfText(abs)
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
  const rawText = await extractPdfText(abs)
  if (!rawText || rawText.trim().length === 0) return 0

  // Replace any old chunks for this doc — re-index is idempotent.
  await deleteDocChunksForDoc(doc.id)

  const chunks = chunkPdfText(rawText.slice(0, SUMMARY_INPUT_MAX_CHARS))
  let inserted = 0
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedTextOrNull(chunks[i])
    if (!embedding) {
      // Embeddings unavailable — bail; partial indexing would mislead retrieval.
      console.warn('[profileDocuments] embeddings unavailable, skipping indexing')
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
    console.warn('[profileDocuments] deleteDocumentFile failed:', e)
  }
}

// Localized category labels live in src/i18n/{en,es}.ts under documents.categories.
// Use `tr.documents.categories[doc.category]` in components.
