import * as FileSystem from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native'

const AVATARS_PREFIX = 'avatars/'
const AVATARS_DIR = `${FileSystem.documentDirectory}${AVATARS_PREFIX}`

// Stored avatarUrl values are relative (e.g. "avatars/member-1_123.jpg").
// Absolute file:// paths written by older builds are also accepted.
export function resolveAvatarUri(avatarUrl: string): string {
  if (avatarUrl.startsWith('file://') || avatarUrl.startsWith('/')) return avatarUrl
  return `${FileSystem.documentDirectory ?? ''}${avatarUrl}`
}

async function ensureAvatarsDir(): Promise<void> {
  if (!FileSystem.documentDirectory) return
  const info = await FileSystem.getInfoAsync(AVATARS_DIR)
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(AVATARS_DIR, { intermediates: true })
  }
}

function promptSource(): Promise<'photos' | 'files' | 'cancel'> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancelar', 'Fotos', 'Archivos'], cancelButtonIndex: 0 },
        (i) => resolve(i === 1 ? 'photos' : i === 2 ? 'files' : 'cancel')
      )
    } else {
      Alert.alert('Seleccionar imagen', undefined, [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve('cancel') },
        { text: 'Galería', onPress: () => resolve('photos') },
        { text: 'Archivos', onPress: () => resolve('files') },
      ])
    }
  })
}

async function pickFromPhotos(memberId: string): Promise<string | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (status !== 'granted') {
    Alert.alert(
      'Permiso denegado',
      'Necesitamos acceso a tu galería para cambiar la foto.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Abrir ajustes', onPress: () => Linking.openSettings() },
      ]
    )
    return null
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  })
  if (result.canceled) return null
  await ensureAvatarsDir()
  const filename = `${memberId}_${Date.now()}.jpg`
  await FileSystem.copyAsync({ from: result.assets[0].uri, to: `${AVATARS_DIR}${filename}` })
  return `${AVATARS_PREFIX}${filename}`
}

async function pickFromFiles(memberId: string): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'image/*',
    copyToCacheDirectory: true,
  })
  if (result.canceled || !result.assets?.[0]) return null
  await ensureAvatarsDir()
  const filename = `${memberId}_${Date.now()}.jpg`
  await FileSystem.copyAsync({ from: result.assets[0].uri, to: `${AVATARS_DIR}${filename}` })
  return `${AVATARS_PREFIX}${filename}`
}

export async function pickAndSaveAvatar(memberId: string): Promise<string | null> {
  const source = await promptSource()
  if (source === 'cancel') return null
  return source === 'photos' ? pickFromPhotos(memberId) : pickFromFiles(memberId)
}

export async function deleteOldAvatar(uri: string): Promise<void> {
  const resolved = resolveAvatarUri(uri)
  if (!resolved.startsWith(FileSystem.documentDirectory ?? '')) return
  await FileSystem.deleteAsync(resolved, { idempotent: true })
}
