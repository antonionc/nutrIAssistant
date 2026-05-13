import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Device from 'expo-device'
import { logger } from '../utils/logger'

// Persisted flag set the first time we detect a low-RAM device. Once set
// it stays set across reboots — re-running detection every cold start
// would be wasteful and creates UX flicker on borderline devices whose
// reported memory fluctuates around the threshold.
const KEY_AI_UNSUPPORTED = 'nutri_ai_unsupported'

// 6 GB total RAM as the cutoff. Below this Qwen 3 1.7B Q reliably OOMs
// during executorch load on Android (Galaxy A series, older iPhones).
// Devices at or above 6 GB load the model with comfortable headroom.
const RAM_THRESHOLD_BYTES = 6 * 1024 * 1024 * 1024

/**
 * Decides whether the AI assistant should be enabled for this device.
 * Once `false`, it stays `false` for the install lifetime — the user can
 * always uninstall + reinstall after a device upgrade if they want to
 * re-run the probe. Cache via AsyncStorage to avoid hitting the native
 * Device API on every render.
 */
export async function isAISupportedOnThisDevice(): Promise<boolean> {
  const cached = await AsyncStorage.getItem(KEY_AI_UNSUPPORTED)
  if (cached === 'true') return false
  if (cached === 'false') return true

  // First time we see this device — probe and persist the decision.
  try {
    // `totalMemory` is bytes on Android, undefined on iOS (Apple does not
    // expose this through public APIs). On iOS we err on the side of
    // permitting the AI: the iPhone hardware that runs iOS 18.1+ has at
    // least 6 GB RAM on every supported model (iPhone 14+).
    const totalMemory = Device.totalMemory
    if (typeof totalMemory === 'number' && totalMemory > 0 && totalMemory < RAM_THRESHOLD_BYTES) {
      await AsyncStorage.setItem(KEY_AI_UNSUPPORTED, 'true')
      logger.info('[Device] AI disabled: low RAM', { totalMemoryGB: totalMemory / 1024 / 1024 / 1024 })
      return false
    }
    await AsyncStorage.setItem(KEY_AI_UNSUPPORTED, 'false')
    return true
  } catch (err) {
    // If the probe itself fails, do not block the user — keep AI enabled
    // and skip the cache write so a future boot can retry.
    logger.warn('[Device] capability probe failed, defaulting to AI-enabled', { err })
    return true
  }
}

/**
 * Test-only: clear the cached flag so the next probe re-evaluates. Also
 * useful from a "Re-check" button if we ever expose one in Settings.
 */
export async function resetAISupportDetection(): Promise<void> {
  await AsyncStorage.removeItem(KEY_AI_UNSUPPORTED)
}
