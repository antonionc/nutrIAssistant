import NetInfo from '@react-native-community/netinfo'
import { AIContext, AIRoute } from '../types/ai'

async function isOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch()
    return !state.isConnected
  } catch {
    return false
  }
}

export function routeQuery(query: string, context: AIContext): AIRoute {
  // Always on-device if offline
  if (context.isOffline) return 'on_device'

  // Cloud only when the task genuinely requires it: PDF or image analysis
  if (context.requiresPDF) return 'cloud'
  if (context.requiresImage) return 'cloud'

  // Everything else runs on-device (Llama 3.2)
  return 'on_device'
}

export { isOffline }
