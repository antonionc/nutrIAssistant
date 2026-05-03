import React, { createContext, useCallback, useContext, useRef } from 'react'
import { AIAssistant } from './AIAssistant'

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

  return (
    <AIAssistantContext.Provider value={{ open, close }}>
      {children}
      <AIAssistant ref={ref} onClose={close} />
    </AIAssistantContext.Provider>
  )
}
