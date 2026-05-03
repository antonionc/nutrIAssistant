import { HealthProvider, HealthProviderId } from '../types'
import { AppleHealthProvider } from './appleHealth'
import { HealthConnectProvider } from './healthConnect'

export const HEALTH_PROVIDERS: Record<HealthProviderId, HealthProvider> = {
  apple_health: AppleHealthProvider,
  health_connect: HealthConnectProvider,
}

export const HEALTH_PROVIDER_IDS: HealthProviderId[] = ['apple_health', 'health_connect']
