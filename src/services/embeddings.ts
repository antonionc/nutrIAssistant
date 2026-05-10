import AsyncStorage from '@react-native-async-storage/async-storage'

// Mirrors the structure of onDeviceLlm.ts but for sentence embeddings.
// `react-native-executorch` is required at runtime; in Expo Go (no native
// build) the require throws and we surface that via getEmbeddingsStatus.
//
// initExecutorch is already called by onDeviceLlm.ts at module load — that
// single call wires the ExpoResourceFetcher for ALL executorch model types,
// so this file does NOT call initExecutorch again.
type TextEmbeddingsModuleClass = typeof import('react-native-executorch').TextEmbeddingsModule
type EmbeddingsInstance = Awaited<ReturnType<TextEmbeddingsModuleClass['fromModelName']>>
type ModelDef = typeof import('react-native-executorch').ALL_MINILM_L6_V2

let TextEmbeddingsModuleRef: TextEmbeddingsModuleClass | null = null
let EmbeddingsModelDef: ModelDef | null = null
try {
  const exe = require('react-native-executorch')
  TextEmbeddingsModuleRef = exe.TextEmbeddingsModule
  // ALL_MINILM_L6_V2 is the smallest text embeddings model: ~28MB, 384-dim.
  // Adequate quality for short medical chunks and conversational queries.
  EmbeddingsModelDef = exe.ALL_MINILM_L6_V2
} catch {
  TextEmbeddingsModuleRef = null
  EmbeddingsModelDef = null
}

let embeddingsInstance: EmbeddingsInstance | null = null
let downloadProgress = 0
let isDownloading = false
let bootstrapPromise: Promise<boolean> | null = null

const KEY_EMBEDDINGS_FIRST_LOAD = 'on_device_embeddings_first_loaded'
export const EMBEDDING_DIM = 384

export interface EmbeddingsStatus {
  isDownloaded: boolean
  isDownloading: boolean
  isLoaded: boolean
  downloadProgress: number
}

export async function isEmbeddingsDownloaded(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_EMBEDDINGS_FIRST_LOAD)) === 'true'
}

export async function ensureEmbeddingsAvailable(
  onPhase?: (phase: 'downloading' | 'loading', progress?: number) => void
): Promise<boolean> {
  if (!TextEmbeddingsModuleRef || !EmbeddingsModelDef) return false
  if (embeddingsInstance) return true
  if (bootstrapPromise) return bootstrapPromise

  bootstrapPromise = (async () => {
    const previouslyLoaded = await isEmbeddingsDownloaded()
    isDownloading = true
    downloadProgress = previouslyLoaded ? 1 : 0
    onPhase?.(previouslyLoaded ? 'loading' : 'downloading', downloadProgress)

    try {
      const instance = await TextEmbeddingsModuleRef!.fromModelName(
        EmbeddingsModelDef!,
        (progress: number) => {
          downloadProgress = progress
          onPhase?.(previouslyLoaded ? 'loading' : 'downloading', progress)
        }
      )
      embeddingsInstance = instance
      downloadProgress = 1
      await AsyncStorage.setItem(KEY_EMBEDDINGS_FIRST_LOAD, 'true')
      return true
    } catch (e) {
      console.error('[Embeddings] Failed to load embeddings model:', e)
      embeddingsInstance = null
      return false
    } finally {
      isDownloading = false
      bootstrapPromise = null
    }
  })()

  return bootstrapPromise
}

// Encode a single text into a 384-dim Float32Array. Throws if model not loaded.
export async function embedText(text: string): Promise<Float32Array> {
  if (!embeddingsInstance) throw new Error('Embeddings model not loaded')
  return embeddingsInstance.forward(text)
}

// Soft variant: returns null if the model isn't ready instead of throwing.
// Callers (PDF indexer, retrieval) prefer this so a missing embeddings model
// degrades gracefully — PDFs still get a summary, chat still works.
export async function embedTextOrNull(text: string): Promise<Float32Array | null> {
  if (!embeddingsInstance) return null
  try {
    return await embeddingsInstance.forward(text)
  } catch (e) {
    console.warn('[Embeddings] forward failed:', e)
    return null
  }
}

export function isEmbeddingsLoaded(): boolean {
  return embeddingsInstance !== null
}

export async function getEmbeddingsStatus(): Promise<EmbeddingsStatus> {
  const previouslyLoaded = await isEmbeddingsDownloaded()
  return {
    isDownloaded: previouslyLoaded,
    isDownloading,
    isLoaded: embeddingsInstance !== null,
    downloadProgress: previouslyLoaded && !isDownloading ? 1 : downloadProgress,
  }
}

export async function unloadEmbeddings(): Promise<void> {
  if (embeddingsInstance) {
    try {
      embeddingsInstance.delete()
    } catch {
      // ignore
    }
    embeddingsInstance = null
  }
}
