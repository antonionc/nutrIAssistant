import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { AIAssistant } from './AIAssistant'
import { ProfileSelectorSheet, ProfileSelectorSheetRef } from '../sheets/ProfileSelectorSheet'
import { useSelectedProfile } from '../../modules/profiles/SelectedProfileContext'
import { isAIAccessibleForMember } from '../../modules/ai-engine/aiAccess'

interface AIAssistantContextValue {
  open: () => void
  close: () => void
}

const AIAssistantContext = createContext<AIAssistantContextValue>({
  open: () => {},
  close: () => {},
})

export function useAIAssistant(): AIAssistantContextValue {
  return useContext(AIAssistantContext)
}

// Renders the AIAssistant bottom sheet exactly once and exposes imperative
// open/close to the rest of the tree via context. Replaces the previous
// pattern of each tab bar instantiating its own &lt;AIAssistant&gt; — the FAB
// and tab bars now share a single host.
export function AIAssistantHost({ children }: { children: React.ReactNode }) {
  const ref = useRef<{ expand: () => void; close: () => void } | null>(null)
  const open = useCallback(() => ref.current?.expand(), [])
  const close = useCallback(() => ref.current?.close(), [])

  // Host the profile selector once and expose its opener via SelectedProfileContext.
  const profileSheetRef = useRef<ProfileSelectorSheetRef>(null)
  const { registerOpener, selected } = useSelectedProfile()
  useEffect(() => {
    registerOpener(() => profileSheetRef.current?.present())
    return () => registerOpener(null)
  }, [registerOpener])

  // Defense-in-depth: if the active profile changes to a minor (or to no
  // profile) while the chat sheet is open, close it immediately. The FAB
  // is already hidden in that state, so the only way the sheet stays
  // visible would be a profile switch performed mid-conversation.
  useEffect(() => {
    if (!isAIAccessibleForMember(selected)) close()
  }, [selected, close])

  return (
    <AIAssistantContext.Provider value={{ open, close }}>
      {children}
      <AIAssistant ref={ref} onClose={close} />
      <ProfileSelectorSheet ref={profileSheetRef} />
    </AIAssistantContext.Provider>
  )
}
