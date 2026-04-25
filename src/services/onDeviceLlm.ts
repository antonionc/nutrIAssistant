import * as FileSystem from 'expo-file-system/legacy'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { OnDeviceLLMStatus } from '../types/ai'

// react-native-executorch dynamic import (requires native build — not available in Expo Go)
let LLMModule: typeof import('react-native-executorch') | null = null
try {
  LLMModule = require('react-native-executorch')
} catch {
  console.log('[OnDeviceLLM] react-native-executorch no disponible, usando Claude API como alternativa')
}

const MODEL_FILENAME = 'llama3_2_1b_q4.gguf'
const MODEL_URL = 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf'
const KEY_MODEL_DOWNLOADED = 'on_device_model_downloaded'
const KEY_PREFER_ON_DEVICE = 'prefer_on_device_ai'

export function getModelPath(): string {
  return `${FileSystem.documentDirectory}${MODEL_FILENAME}`
}

export async function isModelDownloaded(): Promise<boolean> {
  const flag = await AsyncStorage.getItem(KEY_MODEL_DOWNLOADED)
  if (flag !== 'true') return false
  const info = await FileSystem.getInfoAsync(getModelPath())
  return info.exists
}

export async function getPreferOnDevice(): Promise<boolean> {
  const pref = await AsyncStorage.getItem(KEY_PREFER_ON_DEVICE)
  return pref !== 'false' // default: true
}

export async function setPreferOnDevice(value: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_PREFER_ON_DEVICE, value ? 'true' : 'false')
}

export async function downloadModel(
  onProgress: (progress: number, bytesDownloaded: number, bytesTotal: number) => void
): Promise<void> {
  const modelPath = getModelPath()

  const downloadResumable = FileSystem.createDownloadResumable(
    MODEL_URL,
    modelPath,
    {},
    (downloadProgress) => {
      const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress
      const progress = totalBytesExpectedToWrite > 0
        ? totalBytesWritten / totalBytesExpectedToWrite
        : 0
      onProgress(progress, totalBytesWritten, totalBytesExpectedToWrite)
    }
  )

  const result = await downloadResumable.downloadAsync()
  if (!result?.uri) throw new Error('Descarga fallida')

  await AsyncStorage.setItem(KEY_MODEL_DOWNLOADED, 'true')
}

/**
 * Ensures the model is downloaded and loaded into memory.
 * Downloads on first launch, skips download on subsequent launches.
 * Called during app startup before the main UI is shown.
 *
 * Returns false when the native module is unavailable (Expo Go / non-native build).
 * In that case the app falls back to Claude API silently.
 */
export async function ensureModelAvailable(
  onPhase?: (phase: 'downloading' | 'loading', progress?: number) => void
): Promise<boolean> {
  if (!LLMModule) {
    // Native module unavailable — requires `expo run:ios` / `expo run:android`.
    // Fall back to Claude API silently.
    return false
  }

  const downloaded = await isModelDownloaded()
  if (!downloaded) {
    await downloadModel((progress) => onPhase?.('downloading', progress))
  }

  onPhase?.('loading')
  await loadModel()
  return true
}

export async function deleteModel(): Promise<void> {
  const modelPath = getModelPath()
  const info = await FileSystem.getInfoAsync(modelPath)
  if (info.exists) {
    await FileSystem.deleteAsync(modelPath)
  }
  await AsyncStorage.setItem(KEY_MODEL_DOWNLOADED, 'false')
}

// LLM instance (loaded in memory)
let llmInstance: unknown = null

export async function loadModel(): Promise<void> {
  if (!LLMModule) return // native module unavailable — noop, caller uses Claude API
  const downloaded = await isModelDownloaded()
  if (!downloaded) throw new Error('Modelo no descargado')

  const modelPath = getModelPath()
  if (LLMModule && typeof (LLMModule as Record<string, unknown>).LlamaCpp !== 'undefined') {
    const { LlamaCpp } = LLMModule as unknown as { LlamaCpp: { load: (path: string) => Promise<unknown> } }
    llmInstance = await LlamaCpp.load(modelPath)
  }
}

export async function generateOnDevice(
  prompt: string,
  systemPrompt: string,
  onToken?: (token: string) => void
): Promise<string> {
  if (!llmInstance || !LLMModule) {
    throw new Error('LLM local no cargado')
  }

  const fullPrompt = `<|system|>\n${systemPrompt}\n<|user|>\n${prompt}\n<|assistant|>\n`
  const instance = llmInstance as { generate: (p: string, cb?: (t: string) => void) => Promise<string> }
  return instance.generate(fullPrompt, onToken)
}

export async function unloadModel(): Promise<void> {
  if (llmInstance) {
    const instance = llmInstance as { unload?: () => Promise<void> }
    await instance.unload?.()
    llmInstance = null
  }
}

export async function getLLMStatus(): Promise<OnDeviceLLMStatus> {
  const isDownloaded = await isModelDownloaded()
  const isLoaded = llmInstance !== null
  const modelPath = getModelPath()
  let modelSizeBytes: number | undefined

  if (isDownloaded) {
    const info = await FileSystem.getInfoAsync(modelPath)
    if (info.exists && 'size' in info) {
      modelSizeBytes = (info as { exists: true; uri: string; size: number; modificationTime: number; isDirectory: boolean }).size
    }
  }

  return {
    isDownloaded,
    isDownloading: false,
    isLoaded,
    downloadProgress: isDownloaded ? 1 : 0,
    modelSizeBytes,
  }
}
