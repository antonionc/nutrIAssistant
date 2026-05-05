import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { AIMessage, OnDeviceLLMStatus } from '../../types/ai'
import { generateId } from '../../utils/idUtils'
import { useProfiles } from '../profiles/ProfilesContext'
import { usePlanner } from '../planner/PlannerContext'
import { useInventory } from '../inventory/InventoryContext'
import { getSchoolMenuEntries } from '../planner/plannerDB'
import { buildSystemPrompt } from '../../services/prompts/system'
import { getLLMStatus, generateOnDevice } from '../../services/onDeviceLlm'
import { t } from '../../i18n'

interface AIEngineContextValue {
  messages: AIMessage[]
  isResponding: boolean
  modelStatus: OnDeviceLLMStatus
  refreshModelStatus: () => Promise<void>
  sendMessage: (content: string, imageBase64?: string) => Promise<void>
  clearHistory: () => void
}

const AIEngineContext = createContext<AIEngineContextValue | null>(null)

const HISTORY_TURNS = 6 // last N user+assistant turns folded into the prompt

function buildPromptWithHistory(history: AIMessage[], latestUserContent: string): string {
  const recent = history.slice(-HISTORY_TURNS * 2)
  if (recent.length === 0) return latestUserContent
  const lines = recent
    .filter((m) => m.content.trim().length > 0)
    .map((m) => (m.role === 'user' ? `Usuario: ${m.content}` : `Asistente: ${m.content}`))
  lines.push(`Usuario: ${latestUserContent}`)
  return lines.join('\n')
}

export function AIEngineProvider({ children }: { children: React.ReactNode }) {
  const { profiles } = useProfiles()
  const { weekPlans } = usePlanner()
  const { items: inventory } = useInventory()
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [isResponding, setIsResponding] = useState(false)
  const [modelStatus, setModelStatus] = useState<OnDeviceLLMStatus>({
    isDownloaded: false,
    isDownloading: false,
    isLoaded: false,
    downloadProgress: 0,
  })

  const refreshModelStatus = useCallback(async () => {
    try {
      const status = await getLLMStatus()
      setModelStatus(status)
    } catch (e) {
      console.error('[AIEngine] Failed to get LLM status:', e)
    }
  }, [])

  useEffect(() => {
    refreshModelStatus()
    const interval = setInterval(refreshModelStatus, 5000)
    return () => clearInterval(interval)
  }, [refreshModelStatus])

  const sendMessage = useCallback(
    async (content: string, imageBase64?: string) => {
      const userMessage: AIMessage = {
        id: generateId('msg'),
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        imageUri: imageBase64,
      }
      setMessages((prev) => [...prev, userMessage])

      const assistantId = generateId('msg')
      const assistantMessage: AIMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
        route: 'on_device',
      }
      setMessages((prev) => [...prev, assistantMessage])
      setIsResponding(true)

      try {
        if (!modelStatus.isLoaded) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: t.ai.modelPreparingMessage, isStreaming: false }
                : m
            )
          )
          return
        }

        const schoolAgeIds = profiles.filter((p) => p.isSchoolAge).map((p) => p.id)
        const schoolMenuEntries = (
          await Promise.all(schoolAgeIds.map((id) => getSchoolMenuEntries(id)))
        )
          .flat()
          .map((e) => ({ ...e, meal: 'lunch' as const }))

        const systemPrompt = buildSystemPrompt(
          profiles,
          inventory,
          weekPlans,
          schoolMenuEntries.length ? schoolMenuEntries : undefined
        )

        const userPrompt = buildPromptWithHistory(messages, content)

        let fullText = ''
        await generateOnDevice(userPrompt, systemPrompt, (token) => {
          fullText += token
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: fullText } : m
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
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `${t.ai.errorPrefix}: ${errorMsg}`, isStreaming: false }
              : m
          )
        )
      } finally {
        setIsResponding(false)
      }
    },
    [profiles, weekPlans, inventory, messages, modelStatus.isLoaded]
  )

  const clearHistory = useCallback(() => {
    setMessages([])
  }, [])

  return (
    <AIEngineContext.Provider
      value={{
        messages,
        isResponding,
        modelStatus,
        refreshModelStatus,
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
