import { Platform } from 'react-native'
import { HealthData, HealthProvider } from '../types'

// Dynamic require so the bundler tolerates the package being absent
// (Expo Go, Android-only build, etc.). Only iOS native builds will load it.
type AnyHK = {
  Constants?: { Permissions?: Record<string, string> }
  initHealthKit: (
    options: { permissions: { read: string[]; write: string[] } },
    cb: (err: string | null) => void
  ) => void
  getStepCount: (
    options: { startDate: string; endDate?: string },
    cb: (err: string | null, result: { value: number } | null) => void
  ) => void
  getActiveEnergyBurned: (
    options: { startDate: string; endDate?: string },
    cb: (err: string | null, result: { value: number }[] | null) => void
  ) => void
}

let HK: AnyHK | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  HK = require('react-native-health').default as AnyHK
} catch {
  HK = null
}

function getPermissions(): { read: string[]; write: string[] } {
  const P = HK?.Constants?.Permissions ?? {}
  return {
    read: [P.Steps, P.ActiveEnergyBurned].filter(Boolean) as string[],
    write: [],
  }
}

function startOfTodayIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export const AppleHealthProvider: HealthProvider = {
  id: 'apple_health',

  async isAvailable() {
    return Platform.OS === 'ios' && !!HK
  },

  async requestPermissions() {
    if (!HK) return false
    return new Promise<boolean>((resolve) => {
      HK!.initHealthKit({ permissions: getPermissions() }, (err) => {
        if (err) {
          console.warn('[AppleHealth] initHealthKit error:', err)
          resolve(false)
        } else {
          resolve(true)
        }
      })
    })
  },

  async fetchToday(): Promise<HealthData | null> {
    if (!HK) return null
    const opts = { startDate: startOfTodayIso(), endDate: new Date().toISOString() }

    const steps = await new Promise<number>((resolve) => {
      HK!.getStepCount(opts, (err, result) => {
        resolve(err || !result ? 0 : Math.round(result.value ?? 0))
      })
    })

    const calories = await new Promise<number>((resolve) => {
      HK!.getActiveEnergyBurned(opts, (err, results) => {
        if (err || !results) return resolve(0)
        const total = results.reduce((acc, r) => acc + (r.value ?? 0), 0)
        resolve(Math.round(total))
      })
    })

    return {
      steps,
      activeCaloriesBurned: calories,
      date: new Date().toISOString().slice(0, 10),
    }
  },
}
