export type AIRoute = 'on_device'

export interface AIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  imageUri?: string
  isStreaming?: boolean
  route?: AIRoute
}

export interface OnDeviceLLMStatus {
  isDownloaded: boolean
  isDownloading: boolean
  isLoaded: boolean
  downloadProgress: number    // 0–1
  modelSizeBytes?: number
  downloadError?: string
}
