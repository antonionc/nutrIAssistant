export type HealthProviderId = 'apple_health' | 'health_connect'

export interface HealthData {
  steps: number
  activeCaloriesBurned: number  // kcal of *active* energy (not BMR), today only
  date: string                  // ISO YYYY-MM-DD
}

export interface HealthProvider {
  id: HealthProviderId
  // Whether the device + native module can talk to this provider at all.
  isAvailable(): Promise<boolean>
  // Prompts the user for permission. Returns true if granted.
  requestPermissions(): Promise<boolean>
  // Reads today's steps + active calories. Null on any error.
  fetchToday(): Promise<HealthData | null>
}
