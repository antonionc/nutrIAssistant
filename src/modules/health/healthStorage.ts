import AsyncStorage from '@react-native-async-storage/async-storage'
import { HealthProviderId } from './types'

const KEY_ACTIVE_PROVIDER = 'health_active_provider'

export async function getActiveHealthProvider(): Promise<HealthProviderId | null> {
  const v = await AsyncStorage.getItem(KEY_ACTIVE_PROVIDER)
  if (v === 'apple_health' || v === 'health_connect') return v
  return null
}

export async function setActiveHealthProvider(id: HealthProviderId | null): Promise<void> {
  if (id === null) {
    await AsyncStorage.removeItem(KEY_ACTIVE_PROVIDER)
  } else {
    await AsyncStorage.setItem(KEY_ACTIVE_PROVIDER, id)
  }
}
