import NetInfo from '@react-native-community/netinfo'

export async function isOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch()
    return !state.isConnected
  } catch {
    return false
  }
}
