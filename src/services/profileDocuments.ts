import * as FileSystem from 'expo-file-system/legacy'
import * as DocumentPicker from 'expo-document-picker'
import { ProfileDocument, DocumentCategory } from '../types/profiles'
import { generateId } from '../utils/idUtils'
import { extractPdfText } from '../../modules/expo-pdf-text'
import { generateOnDevice } from './onDeviceLlm'

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

const DOC_SUMMARY_SYSTEM_PROMPT = `Eres un asistente médico-nutricional. Resume el siguiente documento clínico/sanitario en español, en máximo 4 frases cortas (máx 500 caracteres en total). Centra el resumen en datos accionables: alergias, intolerancias, condiciones diagnosticadas, restricciones dietéticas, valores de laboratorio fuera de rango, medicación relevante. NO incluyas datos personales identificativos (nombre, fecha exacta, número de historia). Si el documento no contiene información médica clara, responde: "Sin datos clínicos relevantes."`

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
  if (!rawText || rawText.trim().length === 0) {
    return 'Sin datos clínicos relevantes.'
  }
  const truncated = rawText.slice(0, SUMMARY_INPUT_MAX_CHARS)
  const userPrompt = `Documento (${doc.filename}):\n\n${truncated}`
  const summary = await generateOnDevice(userPrompt, DOC_SUMMARY_SYSTEM_PROMPT)
  // Hard cap to protect the system-prompt budget downstream.
  return summary.trim().slice(0, SUMMARY_MAX_CHARS)
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

export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  lab_report: 'Informe de laboratorio',
  medical_history: 'Historia clínica',
  prescription: 'Receta médica',
  other: 'Otro',
}
