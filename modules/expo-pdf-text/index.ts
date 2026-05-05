import { requireNativeModule } from 'expo-modules-core'

interface ExpoPdfTextNative {
  extractText(uri: string): Promise<string>
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
