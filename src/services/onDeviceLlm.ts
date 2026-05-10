import * as FileSystem from 'expo-file-system/legacy'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher'
import { OnDeviceLLMStatus } from '../types/ai'
import { currentLang } from '../utils/locale'

// react-native-executorch is required at runtime. In Expo Go (no native build)
// the require throws — we surface that via getLLMStatus rather than falling
// back to any cloud service.
type LLMModuleClass = typeof import('react-native-executorch').LLMModule
type LLMInstance = Awaited<ReturnType<LLMModuleClass['fromModelName']>>
type LLMModelDef = typeof import('react-native-executorch').QWEN3_1_7B_QUANTIZED

let LLMModuleRef: LLMModuleClass | null = null
// Qwen 3 1.7B (8-bit quantized): ~1 GB, much stronger instruction-following
// and structured-output adherence than the previous Llama 3.2 1B at a
// comparable (slightly larger) on-device footprint. Native context window
// is ~32k, so the historical "rendered chat too long" overflow that
// plagued the 1B model is no longer the failure mode here.
let LLMModelRef: LLMModelDef | null = null
try {
  const exe = require('react-native-executorch')
  LLMModuleRef = exe.LLMModule
  LLMModelRef = exe.QWEN3_1_7B_QUANTIZED
  // executorch v0.8+ requires an explicit ResourceFetcher adapter before any
  // model load. The Expo adapter writes downloads into the app's document
  // directory under `react-native-executorch/`.
  exe.initExecutorch({ resourceFetcher: ExpoResourceFetcher })
} catch {
  LLMModuleRef = null
  LLMModelRef = null
}

let llmInstance: LLMInstance | null = null
let downloadProgress = 0
let isDownloading = false
let activeTokenCallback: ((token: string) => void) | null = null
let bootstrapPromise: Promise<boolean> | null = null

// Sticky flag: once the model has fully loaded at least once, future launches
// can show "loading" instead of "downloading" because executorch's
// ResourceFetcher caches the .pte/tokenizer files.
//
// Bumped to v2 when we migrated from Llama 3.2 1B → Qwen 3 1.7B (Quantized).
// The new key forces existing installs to show the download progress UI on
// the first launch after upgrade (different model, fresh ~1 GB pull).
const KEY_MODEL_FIRST_LOAD = 'on_device_model_first_loaded_qwen3_1_7b_q'

// Removes leftover artifacts from previous on-device LLM versions:
//   1. The very-old GGUF blob from before we adopted executorch.
//   2. Llama 3.2 1B executorch files (.pte + tokenizer JSONs) from before the
//      Qwen 3 1.7B migration. The Expo fetcher names cached files after the
//      full HuggingFace URL with non-alphanumeric chars replaced — so any
//      Llama-derived filename contains the substring "llama" and we can
//      safely match by name.
//   3. Stale AsyncStorage flags pointing at the old model.
//
// Idempotent and best-effort: never let cleanup failure block the load path.
async function cleanupLegacyArtifacts(): Promise<void> {
  // 1. Pre-executorch GGUF
  try {
    const legacyPath = `${FileSystem.documentDirectory}llama3_2_1b_q4.gguf`
    const info = await FileSystem.getInfoAsync(legacyPath)
    if (info.exists) await FileSystem.deleteAsync(legacyPath, { idempotent: true })
  } catch {
    /* ignore */
  }

  // 2. Llama executorch .pte + tokenizer files
  try {
    const rneDir = `${FileSystem.documentDirectory}react-native-executorch/`
    const dirInfo = await FileSystem.getInfoAsync(rneDir)
    if (dirInfo.exists) {
      const files = await FileSystem.readDirectoryAsync(rneDir)
      for (const f of files) {
        if (/llama/i.test(f)) {
          await FileSystem.deleteAsync(`${rneDir}${f}`, { idempotent: true })
        }
      }
    }
  } catch {
    /* ignore */
  }

  // 3. Stale AsyncStorage keys
  await AsyncStorage.removeItem('on_device_model_downloaded')
  await AsyncStorage.removeItem('on_device_model_first_loaded')
}

export async function isModelDownloaded(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_MODEL_FIRST_LOAD)) === 'true'
}

export async function ensureModelAvailable(
  onPhase?: (phase: 'downloading' | 'loading', progress?: number) => void
): Promise<boolean> {
  if (!LLMModuleRef || !LLMModelRef) return false
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
        LLMModelRef!,
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
  if (!llmInstance) {
    throw new Error(currentLang() === 'en' ? 'On-device LLM not loaded' : 'LLM local no cargado')
  }
  activeTokenCallback = onToken ?? null
  try {
    return await llmInstance.generate([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ])
  } catch (e) {
    // Native "Failed to generate text" is opaque. Qwen 3 has a ~32k context
    // window so KV overflow is rare; the more common causes are memory
    // pressure or a transient native error. Re-raise with user-friendly text.
    const msg = e instanceof Error ? e.message : String(e)
    if (/failed to generate text/i.test(msg)) {
      throw new Error(
        currentLang() === 'en'
          ? 'The assistant could not generate a reply. Please try again in a moment.'
          : 'El asistente no pudo generar la respuesta. Inténtalo de nuevo en un momento.'
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
