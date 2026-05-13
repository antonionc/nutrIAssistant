import * as FileSystem from 'expo-file-system/legacy'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher'
import { OnDeviceLLMStatus } from '../types/ai'
import { currentLang } from '../utils/locale'

// react-native-executorch is required at runtime. In Expo Go (no native build)
// the require throws — we surface that via getLLMStatus rather than falling
// back to any cloud service.
type LLMModuleClass = typeof import('react-native-executorch').LLMModule
type LLMInstance = Awaited<ReturnType<LLMModuleClass['fromCustomModel']>>

// Qwen 3 1.7B (8-bit quantized): ~1 GB, much stronger instruction-following
// and structured-output adherence than the previous Llama 3.2 1B at a
// comparable (slightly larger) on-device footprint. Native context window
// is ~32k, so the historical "rendered chat too long" overflow that
// plagued the 1B model is no longer the failure mode here.
//
// We don't use react-native-executorch's `QWEN3_1_7B_QUANTIZED` preset
// (which pulls from HuggingFace) — instead we mirror the same .pte +
// tokenizer files via our Cloudflare BFF (R2-backed). See
// `infra/bff/src/routes/llm.ts`. Wins: lower latency (Cloudflare edge POP
// near the user), zero HuggingFace 5xx exposure during first-run install,
// and we control the SLA.
const BFF_BASE =
  process.env.EXPO_PUBLIC_BFF_BASE_URL ?? 'https://api.nutriassistant.org'
const LLM_BASE = `${BFF_BASE}/v1/llm/qwen3-1.7b`
const MODEL_URL = `${LLM_BASE}/model.pte`
const TOKENIZER_URL = `${LLM_BASE}/tokenizer.json`
const TOKENIZER_CONFIG_URL = `${LLM_BASE}/tokenizer_config.json`

let LLMModuleRef: LLMModuleClass | null = null
try {
  const exe = require('react-native-executorch')
  LLMModuleRef = exe.LLMModule
  // executorch v0.8+ requires an explicit ResourceFetcher adapter before any
  // model load. The Expo adapter writes downloads into the app's document
  // directory under `react-native-executorch/`.
  exe.initExecutorch({ resourceFetcher: ExpoResourceFetcher })
} catch {
  LLMModuleRef = null
}

let llmInstance: LLMInstance | null = null
let downloadProgress = 0
let isDownloading = false
let activeTokenCallback: ((token: string) => void) | null = null
let bootstrapPromise: Promise<boolean> | null = null

// Live load-progress channel. Lets the UI subscribe to download/load progress
// without polling getLLMStatus(). The executorch onDownloadProgress callback
// fires on every chunk; we forward those updates to all subscribers.
//
// Phases:
//   'downloading' — pulling .pte/tokenizers from BFF/R2 (progress 0..1).
//   'loading'     — bytes on disk, native runner is initializing.
//   'ready'       — model is loaded and inference can run.
//   'error'       — the load attempt failed; the bar should hide and the
//                   caller will surface a chat-side error on next attempt.
export type LLMLoadPhase = 'downloading' | 'loading' | 'ready' | 'error'
type LLMLoadListener = (phase: LLMLoadPhase, progress: number) => void
const loadListeners = new Set<LLMLoadListener>()

export function subscribeLLMLoad(listener: LLMLoadListener): () => void {
  loadListeners.add(listener)
  return () => {
    loadListeners.delete(listener)
  }
}

function notifyLoad(phase: LLMLoadPhase, progress: number): void {
  for (const l of loadListeners) {
    try {
      l(phase, progress)
    } catch (e) {
      console.warn('[OnDeviceLLM] load listener threw:', e)
    }
  }
}

// Sticky flag: once the model has fully loaded at least once, future launches
// can show "loading" instead of "downloading" because executorch's
// ResourceFetcher caches the .pte/tokenizer files.
//
// Bumped on each migration that changes the cache key the fetcher derives
// from the URL — different URL means different cached filename, so the
// flag must reset to avoid the "loading" UI lying about an absent file:
//   v1 (implicit)          Llama 3.2 1B from HuggingFace
//   _qwen3_1_7b_q          Qwen 3 1.7B from HuggingFace
//   _qwen3_1_7b_q_bff      Qwen 3 1.7B from our Cloudflare BFF (current)
const KEY_MODEL_FIRST_LOAD = 'on_device_model_first_loaded_qwen3_1_7b_q_bff'

// Removes leftover artifacts from previous on-device LLM versions:
//   1. The very-old GGUF blob from before we adopted executorch.
//   2. Llama 3.2 1B executorch files (.pte + tokenizer JSONs) from before the
//      Qwen 3 1.7B migration. The Expo fetcher names cached files after the
//      full URL with non-alphanumeric chars replaced — so any Llama-derived
//      filename contains the substring "llama" and we match by name.
//   3. HuggingFace-cached Qwen 3 files from before the BFF migration. Same
//      naming scheme → any HF-sourced filename contains "huggingface".
//   4. Stale AsyncStorage flags pointing at the old model.
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

  // 2 & 3. Llama executorch + HF-sourced Qwen files
  try {
    const rneDir = `${FileSystem.documentDirectory}react-native-executorch/`
    const dirInfo = await FileSystem.getInfoAsync(rneDir)
    if (dirInfo.exists) {
      const files = await FileSystem.readDirectoryAsync(rneDir)
      for (const f of files) {
        if (/llama|huggingface/i.test(f)) {
          await FileSystem.deleteAsync(`${rneDir}${f}`, { idempotent: true })
        }
      }
    }
  } catch {
    /* ignore */
  }

  // 4. Stale AsyncStorage keys
  await AsyncStorage.removeItem('on_device_model_downloaded')
  await AsyncStorage.removeItem('on_device_model_first_loaded')
  await AsyncStorage.removeItem('on_device_model_first_loaded_qwen3_1_7b_q')
}

export async function isModelDownloaded(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_MODEL_FIRST_LOAD)) === 'true'
}

export async function ensureModelAvailable(
  onPhase?: (phase: 'downloading' | 'loading', progress?: number) => void
): Promise<boolean> {
  if (!LLMModuleRef) return false
  if (llmInstance) return true
  if (bootstrapPromise) return bootstrapPromise

  bootstrapPromise = (async () => {
    await cleanupLegacyArtifacts()

    const previouslyLoaded = await isModelDownloaded()
    isDownloading = true
    downloadProgress = previouslyLoaded ? 1 : 0
    const initialPhase: LLMLoadPhase = previouslyLoaded ? 'loading' : 'downloading'
    onPhase?.(initialPhase, downloadProgress)
    notifyLoad(initialPhase, downloadProgress)

    try {
      const instance = await LLMModuleRef!.fromCustomModel(
        MODEL_URL,
        TOKENIZER_URL,
        TOKENIZER_CONFIG_URL,
        (progress: number) => {
          downloadProgress = progress
          const phase: LLMLoadPhase = previouslyLoaded ? 'loading' : 'downloading'
          onPhase?.(phase, progress)
          notifyLoad(phase, progress)
        },
        (token: string) => activeTokenCallback?.(token)
      )
      llmInstance = instance
      downloadProgress = 1
      await AsyncStorage.setItem(KEY_MODEL_FIRST_LOAD, 'true')
      notifyLoad('ready', 1)
      return true
    } catch (e) {
      console.error('[OnDeviceLLM] Failed to load LLM:', e)
      llmInstance = null
      // Tell subscribers the attempt is over so the UI bar doesn't stay
      // visible forever waiting for a 'ready' that will never come.
      notifyLoad('error', downloadProgress)
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
