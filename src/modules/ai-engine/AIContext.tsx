import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { AIContext as AIContextType, AIMessage, AIRoute, OnDeviceLLMStatus } from '../../types/ai'
import { generateId } from '../../utils/idUtils'
import { useProfiles } from '../profiles/ProfilesContext'
import { routeQuery, isOffline } from '../../services/aiRouter'
import { streamCompletion, complete } from '../../services/claude'
import { buildCloudSystemPrompt } from '../../services/prompts/cloud'
import { buildOnDeviceSystemPrompt } from '../../services/prompts/onDevice'
import {
  getLLMStatus,
  getPreferOnDevice,
  generateOnDevice,
} from '../../services/onDeviceLlm'
interface AIEngineContextValue {
  messages: AIMessage[]
  isResponding: boolean
  sendMessage: (content: string, imageBase64?: string) => Promise<void>
  clearHistory: () => void
}

const AIEngineContext = createContext<AIEngineContextValue | null>(null)

export function AIEngineProvider({ children }: { children: React.ReactNode }) {
  const { profiles } = useProfiles()
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [isResponding, setIsResponding] = useState(false)
  const [llmStatus, setLlmStatus] = useState<OnDeviceLLMStatus>({
    isDownloaded: false,
    isDownloading: false,
    isLoaded: false,
    downloadProgress: 0,
  })
  useEffect(() => {
    getLLMStatus().then(setLlmStatus).catch((e) => {
      console.error('[AIEngine] Failed to get LLM status:', e)
    })
  }, [])

  const sendMessage = useCallback(
    async (content: string, imageBase64?: string) => {
      const offline = await isOffline()
      const context: AIContextType = {
        familyProfiles: profiles,
        inventory: [],
        currentMealPlan: [],
        schoolMenuEntries: [],
        isOffline: offline,
        requiresImage: !!imageBase64,
        imageBase64,
      }

      const userMessage: AIMessage = {
        id: generateId('msg'),
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        imageUri: imageBase64,
      }

      setMessages((prev) => [...prev, userMessage])
      setIsResponding(true)

      const route = routeQuery(content, context)
      const preferOnDevice = await getPreferOnDevice()

      // Assistant placeholder for streaming
      const assistantId = `msg-${Date.now() + 1}`
      const assistantMessage: AIMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
        route,
      }
      setMessages((prev) => [...prev, assistantMessage])

      try {
        const allMessages = [...messages, userMessage]

        if (route === 'on_device' && preferOnDevice && llmStatus.isLoaded) {
          // Use on-device LLM
          const systemPrompt = buildOnDeviceSystemPrompt(profiles, [])
          let fullText = ''
          await generateOnDevice(content, systemPrompt, (token) => {
            fullText += token
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: fullText }
                  : m
              )
            )
          })
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: fullText, isStreaming: false }
                : m
            )
          )
        } else {
          // Use Claude API
          const systemPrompt = buildCloudSystemPrompt(profiles, [], [], [])

          await streamCompletion(allMessages, systemPrompt, {
            onDelta: (text) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + text }
                    : m
                )
              )
            },
            onComplete: (fullText) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: fullText, isStreaming: false }
                    : m
                )
              )
            },
            onError: (error) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: `Sorry, I encountered an error: ${error.message}`,
                        isStreaming: false,
                      }
                    : m
                )
              )
            },
          })
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Sorry, something went wrong: ${errorMsg}`, isStreaming: false }
              : m
          )
        )
      } finally {
        setIsResponding(false)
      }
    },
    [profiles, messages, llmStatus.isLoaded]
  )

  const clearHistory = useCallback(() => {
    setMessages([])
  }, [])

  return (
    <AIEngineContext.Provider
      value={{
        messages,
        isResponding,
        sendMessage,
        clearHistory,
      }}
    >
      {children}
    </AIEngineContext.Provider>
  )
}

export function useAIEngine(): AIEngineContextValue {
  const ctx = useContext(AIEngineContext)
  if (!ctx) throw new Error('useAIEngine must be used within AIEngineProvider')
  return ctx
}
