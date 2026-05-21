import { requireNativeModule } from 'expo-modules-core'

// One line of text extracted from a PDF, with its bounding rect on the page.
// Coordinates are in PDF user-space units (typically 1pt = 1/72 inch). Origin
// is bottom-left; `y` is the TOP edge of the line (maxY of the bounds rect).
export interface PdfTextLine {
  page: number
  text: string
  x: number   // minX (left edge)
  y: number   // maxY (top edge; larger y means higher on the page)
  w: number   // width
  h: number   // height
}

interface ExpoPdfTextNative {
  extractText(uri: string): Promise<string>
  extractTextLines(uri: string): Promise<PdfTextLine[]>
}

let nativeModule: ExpoPdfTextNative | null = null
try {
  nativeModule = requireNativeModule('ExpoPdfText') as ExpoPdfTextNative
} catch {
  nativeModule = null
}

// Extract plain text from a local PDF file.
// `uri` accepts both "file://..." paths and bare filesystem paths.
// Throws if the native module isn't linked (Expo Go) or if the PDF can't be parsed.
export async function extractPdfText(uri: string): Promise<string> {
  if (!nativeModule) {
    throw new Error(
      'PDF text extraction requires a development build. Run "expo run:ios" or "expo run:android".'
    )
  }
  return nativeModule.extractText(uri)
}

/**
 * Extract text from a PDF with per-line geometric bounds.
 *
 * iOS: returns one entry per `PDFSelection.selectionsByLine()` segment with
 * clean text and accurate bounds.
 *
 * Android: currently returns `[]` (PdfBox positional extraction is more
 * involved); callers should fall back to `extractPdfText` when this is empty.
 *
 * Returns `[]` if the native module isn't linked or the call fails so callers
 * can fall back to text-only extraction without a try/catch.
 */
export async function extractPdfTextLines(uri: string): Promise<PdfTextLine[]> {
  if (!nativeModule) return []
  if (typeof nativeModule.extractTextLines !== 'function') return []
  try {
    return await nativeModule.extractTextLines(uri)
  } catch {
    return []
  }
}
