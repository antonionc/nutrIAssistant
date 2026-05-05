import * as FileSystem from 'expo-file-system/legacy'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher'
import { OnDeviceLLMStatus } from '../types/ai'

// react-native-executorch is required at runtime. In Expo Go (no native build)
// the require throws — we surface that via getLLMStatus rather than falling
// back to any cloud service.
type LLMModuleClass = typeof import('react-native-executorch').LLMModule
type LLMInstance = Awaited<ReturnType<LLMModuleClass['fromModelName']>>
type LlamaConst = typeof import('react-native-executorch').LLAMA3_2_1B

let LLMModuleRef: LLMModuleClass | null = null
let LlamaModelDef: LlamaConst | null = null
try {
  const exe = require('react-native-executorch')
  LLMModuleRef = exe.LLMModule
  LlamaModelDef = exe.LLAMA3_2_1B
  // executorch v0.8+ requires an explicit ResourceFetcher adapter before any
  // model load. The Expo adapter writes downloads into the app's document
  // directory under `react-native-executorch/`.
  exe.initExecutorch({ resourceFetcher: ExpoResourceFetcher })
} catch {
  LLMModuleRef = null
  LlamaModelDef = null
}

let llmInstance: LLMInstance | null = null
let downloadProgress = 0
let isDownloading = false
let activeTokenCallback: ((token: string) => void) | null = null
let bootstrapPromise: Promise<boolean> | null = null

// Sticky flag: once the model has fully loaded at least once, future launches
// can show "loading" instead of "downloading" because executorch's
// ResourceFetcher caches the .pte/tokenizer files.
const KEY_MODEL_FIRST_LOAD = 'on_device_model_first_loaded'

// Pre-executorch versions of this app downloaded a GGUF blob directly from
// HuggingFace. That file is unusable to executorch and is just wasting ~800MB.
async function cleanupLegacyArtifacts(): Promise<void> {
  try {
    const legacyPath = `${FileSystem.documentDirectory}llama3_2_1b_q4.gguf`
    const info = await FileSystem.getInfoAsync(legacyPath)
    if (info.exists) await FileSystem.deleteAsync(legacyPath, { idempotent: true })
  } catch {
    // best-effort cleanup; never let this block load
  }
  await AsyncStorage.removeItem('on_device_model_downloaded')
}

export async function isModelDownloaded(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_MODEL_FIRST_LOAD)) === 'true'
}

export async function ensureModelAvailable(
  onPhase?: (phase: 'downloading' | 'loading', progress?: number) => void
): Promise<boolean> {
  if (!LLMModuleRef || !LlamaModelDef) return false
  if (llmInstance) return true
  if (bootstrapPromise) return bootstrapPromise

  bootstrapPromise = (async () => {
    await cleanupLegacyArtifacts()

    const previouslyLoaded = await isModelDownloaded()
    isDownloading = true
    downloadProgress = previouslyLoaded ? 1 : 0
    onPhase?.(previouslyLoaded ? 'loading' : 'downloading', downloadProgress)

    try {
      const instance = await LLMModuleRef!.fromModelName(
        LlamaModelDef!,
        (progress: number) => {
          downloadProgress = progress
          onPhase?.(previouslyLoaded ? 'loading' : 'downloading', progress)
        },
        (token: string) => activeTokenCallback?.(token)
      )
      llmInstance = instance
      downloadProgress = 1
      await AsyncStorage.setItem(KEY_MODEL_FIRST_LOAD, 'true')
      return true
    } catch (e) {
      console.error('[OnDeviceLLM] Failed to load LLM:', e)
      llmInstance = null
      return false
    } finally {
      isDownloading = false
      bootstrapPromise = null
    }
  })()

  return bootstrapPromise
}

// Internal recovery only — not exposed to user UI. Wipes the persisted flag
// AND the in-memory instance so the next ensureModelAvailable triggers a
// fresh download/load through executorch's ResourceFetcher.
export async function deleteModel(): Promise<void> {
  if (llmInstance) {
    try {
      llmInstance.delete()
    } catch {
      // ignore
    }
    llmInstance = null
  }
  await AsyncStorage.removeItem(KEY_MODEL_FIRST_LOAD)
}

export async function generateOnDevice(
  prompt: string,
  systemPrompt: string,
  onToken?: (token: string) => void
): Promise<string> {
  if (!llmInstance) throw new Error('LLM local no cargado')
  activeTokenCallback = onToken ?? null
  try {
    return await llmInstance.generate([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ])
  } catch (e) {
    // Native "Failed to generate text" is opaque. The most common cause on
    // this mobile build is the rendered chat exceeding the model's KV-cache
    // window. Re-raise with a clearer message so callers/UI can react.
    const msg = e instanceof Error ? e.message : String(e)
    if (/failed to generate text/i.test(msg)) {
      throw new Error(
        'El asistente no pudo generar la respuesta (probablemente porque el contexto es demasiado largo). Intenta una pregunta más corta.'
      )
    }
    throw e
  } finally {
    activeTokenCallback = null
  }
}

export async function unloadModel(): Promise<void> {
  if (llmInstance) {
    try {
      llmInstance.delete()
    } catch {
      // ignore
    }
    llmInstance = null
  }
}

export async function getLLMStatus(): Promise<OnDeviceLLMStatus> {
  const previouslyLoaded = await isModelDownloaded()
  return {
    isDownloaded: previouslyLoaded,
    isDownloading,
    isLoaded: llmInstance !== null,
    downloadProgress: previouslyLoaded && !isDownloading ? 1 : downloadProgress,
  }
}

// Used by the dev-only "redownload" button in settings. Triggers a fresh
// download via the executorch ResourceFetcher.
export async function downloadModel(
  onProgress: (progress: number, bytesDownloaded: number, bytesTotal: number) => void
): Promise<void> {
  await deleteModel()
  await ensureModelAvailable((phase, progress) => {
    if (phase === 'downloading' && typeof progress === 'number') {
      onProgress(progress, 0, 0)
    }
  })
}
