import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { HealthData, HealthProviderId } from './types'
import { getActiveHealthProvider, setActiveHealthProvider } from './healthStorage'
import { HEALTH_PROVIDERS } from './providers'

interface HealthContextValue {
  activeId: HealthProviderId | null
  data: HealthData | null
  isLoading: boolean
  // Activates a provider after asking for OS permissions. Deactivates any
  // previously active provider so kcal aren't double-counted. Returns true
  // on success.
  activateProvider: (id: HealthProviderId) => Promise<boolean>
  deactivateProvider: () => Promise<void>
  refresh: () => Promise<void>
  isAvailable: (id: HealthProviderId) => Promise<boolean>
}

const HealthContext = createContext<HealthContextValue | null>(null)

export function HealthProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveIdState] = useState<HealthProviderId | null>(null)
  const [data, setData] = useState<HealthData | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Restore active provider on mount.
  useEffect(() => {
    getActiveHealthProvider().then((id) => {
      setActiveIdState(id)
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!activeId) {
      setData(null)
      return
    }
    setIsLoading(true)
    try {
      const result = await HEALTH_PROVIDERS[activeId].fetchToday()
      setData(result)
    } finally {
      setIsLoading(false)
    }
  }, [activeId])

  // Whenever the active provider changes, fetch fresh data.
  useEffect(() => {
    refresh()
  }, [refresh])

  const activateProvider = useCallback(
    async (id: HealthProviderId): Promise<boolean> => {
      const provider = HEALTH_PROVIDERS[id]
      const available = await provider.isAvailable()
      if (!available) return false
      const granted = await provider.requestPermissions()
      if (!granted) return false
      // Single-active rule: deactivate any other before persisting the new one.
      await setActiveHealthProvider(id)
      setActiveIdState(id)
      return true
    },
    []
  )

  const deactivateProvider = useCallback(async () => {
    await setActiveHealthProvider(null)
    setActiveIdState(null)
    setData(null)
  }, [])

  const isAvailable = useCallback(
    async (id: HealthProviderId) => HEALTH_PROVIDERS[id].isAvailable(),
    []
  )

  return (
    <HealthContext.Provider
      value={{
        activeId,
        data,
        isLoading,
        activateProvider,
        deactivateProvider,
        refresh,
        isAvailable,
      }}
    >
      {children}
    </HealthContext.Provider>
  )
}

export function useHealth(): HealthContextValue {
  const ctx = useContext(HealthContext)
  if (!ctx) throw new Error('useHealth must be used within a HealthProvider')
  return ctx
}
