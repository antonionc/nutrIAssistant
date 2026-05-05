import { t } from '../i18n'

// Lazy import — expo-notifications is optional at runtime so we don't block
// initialization on simulators or test environments where it isn't installed.
type NotificationsModule = typeof import('expo-notifications')

let cachedModule: NotificationsModule | null | undefined

function loadModule(): NotificationsModule | null {
  if (cachedModule !== undefined) return cachedModule
  try {
    cachedModule = require('expo-notifications') as NotificationsModule
  } catch {
    cachedModule = null
  }
  return cachedModule
}

let permissionRequested = false

async function ensurePermission(): Promise<boolean> {
  const Notifications = loadModule()
  if (!Notifications) return false

  if (permissionRequested) {
    const settings = await Notifications.getPermissionsAsync()
    return settings.granted || settings.ios?.status === 3 // PROVISIONAL
  }
  permissionRequested = true

  const existing = await Notifications.getPermissionsAsync()
  if (existing.granted) return true
  const requested = await Notifications.requestPermissionsAsync()
  return requested.granted
}

async function fire(title: string, body: string): Promise<void> {
  const Notifications = loadModule()
  if (!Notifications) return
  if (!(await ensurePermission())) return

  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  })
}

export async function notifyDownloadStarted(): Promise<void> {
  await fire(t.settings.aiModelDownloadingNotification, t.settings.aiModelPreparing)
}

export async function notifyModelReady(): Promise<void> {
  await fire(t.settings.aiModelReadyNotification, t.settings.aiModelReadyBody)
}
