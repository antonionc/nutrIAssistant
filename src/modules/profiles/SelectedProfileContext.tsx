import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { FamilyMember } from '../../types/profiles'
import { useProfiles } from './ProfilesContext'

interface SelectedProfileContextValue {
  selected: FamilyMember | null
  selectedId: string | null
  select: (id: string) => void
  isSuperUser: boolean
  canEdit: (memberId: string) => boolean
  openSelector: () => void
  // Used by the host (AIAssistantHost) to register its sheet.present handler
  registerOpener: (fn: (() => void) | null) => void
}

const SelectedProfileContext = createContext<SelectedProfileContextValue | null>(null)

export function SelectedProfileProvider({ children }: { children: React.ReactNode }) {
  const { profiles } = useProfiles()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const openerRef = useRef<(() => void) | null>(null)

  // Default to profiles[0]; recover when the current selection is removed.
  // Selection is intentionally NOT persisted: every fresh launch starts at profiles[0].
  useEffect(() => {
    if (profiles.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      return
    }
    if (!selectedId || !profiles.find((p) => p.id === selectedId)) {
      setSelectedId(profiles[0].id)
    }
  }, [profiles, selectedId])

  const selected = useMemo(
    () => profiles.find((p) => p.id === selectedId) ?? null,
    [profiles, selectedId]
  )

  const select = useCallback((id: string) => setSelectedId(id), [])

  const canEdit = useCallback(
    (memberId: string) => {
      if (!selected) return false
      return selected.isSuperUser || memberId === selected.id
    },
    [selected]
  )

  const registerOpener = useCallback((fn: (() => void) | null) => {
    openerRef.current = fn
  }, [])

  const openSelector = useCallback(() => {
    openerRef.current?.()
  }, [])

  const value = useMemo<SelectedProfileContextValue>(
    () => ({
      selected,
      selectedId,
      select,
      isSuperUser: selected?.isSuperUser === true,
      canEdit,
      openSelector,
      registerOpener,
    }),
    [selected, selectedId, select, canEdit, openSelector, registerOpener]
  )

  return <SelectedProfileContext.Provider value={value}>{children}</SelectedProfileContext.Provider>
}

export function useSelectedProfile(): SelectedProfileContextValue {
  const ctx = useContext(SelectedProfileContext)
  if (!ctx) throw new Error('useSelectedProfile must be used within SelectedProfileProvider')
  return ctx
}
