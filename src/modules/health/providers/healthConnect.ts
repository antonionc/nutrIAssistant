import { Platform } from 'react-native'
import { HealthData, HealthProvider } from '../types'
import { logger } from '../../../utils/logger'

type AnyHC = {
  initialize: () => Promise<boolean>
  getSdkStatus: () => Promise<number>
  SdkAvailabilityStatus: { SDK_AVAILABLE: number }
  requestPermission: (
    permissions: { accessType: 'read' | 'write'; recordType: string }[]
  ) => Promise<{ accessType: string; recordType: string }[]>
  readRecords: (
    recordType: string,
    options: {
      timeRangeFilter: {
        operator: 'between'
        startTime: string
        endTime: string
      }
    }
  ) => Promise<{ records: Record<string, unknown>[] }>
}

let HC: AnyHC | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  HC = require('react-native-health-connect') as AnyHC
} catch {
  HC = null
}

const PERMS = [
  { accessType: 'read' as const, recordType: 'Steps' },
  { accessType: 'read' as const, recordType: 'ActiveCaloriesBurned' },
]

function todayRangeFilter() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return {
    timeRangeFilter: {
      operator: 'between' as const,
      startTime: start.toISOString(),
      endTime: new Date().toISOString(),
    },
  }
}

export const HealthConnectProvider: HealthProvider = {
  id: 'health_connect',

  async isAvailable() {
    if (Platform.OS !== 'android' || !HC) return false
    try {
      const status = await HC.getSdkStatus()
      return status === HC.SdkAvailabilityStatus.SDK_AVAILABLE
    } catch {
      return false
    }
  },

  async requestPermissions() {
    if (!HC) return false
    try {
      await HC.initialize()
      const granted = await HC.requestPermission(PERMS)
      return granted.length === PERMS.length
    } catch (e) {
      logger.warn('[HealthConnect] requestPermission error:', e)
      return false
    }
  },

  async fetchToday(): Promise<HealthData | null> {
    if (!HC) return null
    try {
      const filter = todayRangeFilter()
      const [stepsRes, caloriesRes] = await Promise.all([
        HC.readRecords('Steps', filter),
        HC.readRecords('ActiveCaloriesBurned', filter),
      ])

      const steps = stepsRes.records.reduce<number>(
        (acc, r) => acc + ((r.count as number | undefined) ?? 0),
        0
      )

      // Health Connect returns energy as { inKilocalories: number, inJoules: number } etc.
      const calories = caloriesRes.records.reduce<number>((acc, r) => {
        const energy = r.energy as { inKilocalories?: number } | undefined
        return acc + (energy?.inKilocalories ?? 0)
      }, 0)

      return {
        steps: Math.round(steps),
        activeCaloriesBurned: Math.round(calories),
        date: new Date().toISOString().slice(0, 10),
      }
    } catch (e) {
      logger.warn('[HealthConnect] fetchToday error:', e)
      return null
    }
  },
}
