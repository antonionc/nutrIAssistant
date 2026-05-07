import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { AIMessage, OnDeviceLLMStatus } from '../../types/ai'
import { generateId } from '../../utils/idUtils'
import { useProfiles } from '../profiles/ProfilesContext'
import { useSelectedProfile } from '../profiles/SelectedProfileContext'
import { usePlanner } from '../planner/PlannerContext'
import { useInventory } from '../inventory/InventoryContext'
import { getSchoolMenuEntries } from '../planner/plannerDB'
import { buildSystemPrompt, RecipeRef } from '../../services/prompts/system'
import { getLLMStatus, generateOnDevice } from '../../services/onDeviceLlm'
import { t } from '../../i18n'
import { parseActions, describeAction } from '../../services/aiActions'
import { getAllRecipes, getRecipesByIds } from '../recipes/recipeDB'

interface AIEngineContextValue {
  messages: AIMessage[]
  isResponding: boolean
  modelStatus: OnDeviceLLMStatus
  lastActionToast: string | null
  refreshModelStatus: () => Promise<void>
  sendMessage: (content: string, imageBase64?: string) => Promise<void>
  clearHistory: () => void
  dismissActionToast: () => void
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
  const { profiles, applyAIActions } = useProfiles()
  const { selectedId } = useSelectedProfile()
  const { weekPlans } = usePlanner()
  const { items: inventory } = useInventory()
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [isResponding, setIsResponding] = useState(false)
  const [lastActionToast, setLastActionToast] = useState<string | null>(null)
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

        // Build a recipe index for the system prompt: candidate ids the LLM
        // can reference in <actions>, plus names so favorites can be rendered.
        const favoriteIds = Array.from(
          new Set(profiles.flatMap((p) => p.favoriteRecipeIds))
        )
        const [favoriteRecipes, available] = await Promise.all([
          favoriteIds.length > 0 ? getRecipesByIds(favoriteIds) : Promise.resolve([]),
          getAllRecipes(20, 0),
        ])
        const recipeIndex = new Map<string, string>()
        for (const r of favoriteRecipes) recipeIndex.set(r.id, r.name)
        for (const r of available) recipeIndex.set(r.id, r.name)
        const availableRecipes: RecipeRef[] = available.map((r) => ({ id: r.id, name: r.name }))

        const systemPrompt = buildSystemPrompt(
          profiles,
          inventory,
          weekPlans,
          schoolMenuEntries.length ? schoolMenuEntries : undefined,
          { recipeIndex, availableRecipes, activeMemberId: selectedId ?? undefined }
        )

        const userPrompt = buildPromptWithHistory(messages, content)

        // Accumulate raw tokens (including any <actions> block). We strip the
        // block once the LLM finishes — partial JSON would render briefly,
        // which is acceptable on this small mobile model.
        let fullText = ''
        await generateOnDevice(userPrompt, systemPrompt, (token) => {
          fullText += token
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: fullText } : m
            )
          )
        })

        const { cleanText, actions } = parseActions(fullText)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: cleanText, isStreaming: false }
              : m
          )
        )

        if (actions.length > 0) {
          const result = await applyAIActions(actions)
          if (result.applied > 0) {
            // Build a human-readable toast from the FIRST applied action.
            // (Multiple actions in one turn are rare on Llama 3.2 1B.)
            const first = actions[0]
            const member = profiles.find((p) => p.id === first.memberId)
            const recipeName = recipeIndex.get(first.recipeId)
            setLastActionToast(
              describeAction(first, { memberName: member?.name, recipeName })
            )
          }
        }
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
    [profiles, weekPlans, inventory, messages, modelStatus.isLoaded, applyAIActions, selectedId]
  )

  const clearHistory = useCallback(() => {
    setMessages([])
  }, [])

  const dismissActionToast = useCallback(() => setLastActionToast(null), [])

  // Auto-clear toast after 3.5s so it doesn't linger if the user doesn't
  // interact with the chat sheet again immediately.
  useEffect(() => {
    if (!lastActionToast) return
    const timer = setTimeout(() => setLastActionToast(null), 3500)
    return () => clearTimeout(timer)
  }, [lastActionToast])

  return (
    <AIEngineContext.Provider
      value={{
        messages,
        isResponding,
        modelStatus,
        lastActionToast,
        refreshModelStatus,
        sendMessage,
        clearHistory,
        dismissActionToast,
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
