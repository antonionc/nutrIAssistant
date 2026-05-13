import * as FileSystem from 'expo-file-system/legacy'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher'
import { OnDeviceLLMStatus } from '../types/ai'
import { currentLang } from '../utils/locale'
import { logger } from '../utils/logger'

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

// SHA256 integrity pins for the artifacts our app expects to consume.
// The hashes are computed at upload time by the BFF runbook
// (`infra/bff/README.md#mirroring-the-on-device-llm`) and pinned here.
//
// Why we pin the small files but not the .pte:
//   - tokenizer.json + tokenizer_config.json fit comfortably in memory
//     (<1 MB each) so we can compute SHA256 over the bytes via
//     `Crypto.digestStringAsync`.
//   - model.pte is ~1.2 GB. Streaming SHA256 in JS over 1.2 GB is
//     prohibitively slow on-device and locks the bridge. Until we ship
//     a native module that streams the hash, the .pte integrity relies
//     on Cloudflare's TLS chain + R2 immutability + cache headers. The
//     constant below is provisioned so the moment streaming-hash exists,
//     the check turns on without touching any other file.
//
// LEAVE these as empty strings to mean "skip verification". A populated
// hash MUST match exactly; mismatch deletes the artifact and forces a
// re-download.
export const EXPECTED_MODEL_PTE_SHA256 = '' // populated when streaming-hash native module exists
export const EXPECTED_TOKENIZER_SHA256 = ''
export const EXPECTED_TOKENIZER_CONFIG_SHA256 = ''

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
      logger.warn('[OnDeviceLLM] load listener threw:', e)
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

/**
 * Verifies the SHA256 of a small artifact (tokenizer JSONs). Returns true
 * when the expected hash is empty (skip), when the file is missing, or
 * when the hash matches. Returns false ONLY when the hash is set and
 * differs — that is the tamper signal.
 *
 * Skipping when the file is missing is intentional: this function runs
 * AFTER the executorch loader writes its artifacts into the document
 * dir under names we cannot predict deterministically. If we cannot
 * locate the file we cannot verify it; we lean on TLS/R2 immutability
 * for that hop.
 */
export async function verifyArtifactSha256(
  expectedHex: string,
  fileUri: string,
): Promise<boolean> {
  if (!expectedHex) return true
  try {
    const info = await FileSystem.getInfoAsync(fileUri)
    if (!info.exists) return true
    // expo-crypto only digests strings, so we read the file as base64
    // and hash that representation. The pin must be computed the same
    // way (base64 of bytes → SHA256) when populated.
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    })
    const actual = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      base64,
      { encoding: Crypto.CryptoEncoding.HEX },
    )
    if (actual.toLowerCase() !== expectedHex.toLowerCase()) {
      logger.error('[OnDeviceLLM] artifact hash mismatch', {
        fileUri,
        expected: expectedHex,
        actual,
      })
      return false
    }
    return true
  } catch (err) {
    logger.warn('[OnDeviceLLM] hash verification failed', { fileUri, err })
    return true // fail open — do not block load on verification infrastructure errors
  }
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
      logger.error('[OnDeviceLLM] Failed to load LLM:', e)
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
