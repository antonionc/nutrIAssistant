import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AIMessage, OnDeviceLLMStatus } from '../../types/ai'
import { generateId } from '../../utils/idUtils'
import { useProfiles } from '../profiles/ProfilesContext'
import { useSelectedProfile } from '../profiles/SelectedProfileContext'
import { usePlanner } from '../planner/PlannerContext'
import { useInventory } from '../inventory/InventoryContext'
import { getSchoolMenuEntries } from '../planner/plannerDB'
import { buildSystemPrompt, RecipeRef, RetrievedDocChunk } from '../../services/prompts/system'
import { getLLMStatus, generateOnDevice, ensureModelAvailable } from '../../services/onDeviceLlm'
import { embedTextOrNull } from '../../services/embeddings'
import { retrievePdfChunks, rankByKeywordOverlap } from '../../services/retrieval'
import { getTopMemoriesForMember, addMemberMemory } from '../../services/memoryStore'
import { extractFactsFromTurn, CandidateFact } from '../../services/factExtractor'
import { classify, getRefusalMessage } from '../../services/topicGate'
import { t } from '../../i18n'
import { parseActions, describeAction, stripThinkingBlock } from '../../services/aiActions'
import { getAllRecipes, getRecipesByIds } from '../recipes/recipeDB'

export interface PendingFact {
  text: string
  category: CandidateFact['category']
  memberId: string
}

interface AIEngineContextValue {
  messages: AIMessage[]
  isResponding: boolean
  modelStatus: OnDeviceLLMStatus
  lastActionToast: string | null
  pendingFacts: PendingFact[]
  refreshModelStatus: () => Promise<void>
  sendMessage: (content: string, imageBase64?: string) => Promise<void>
  clearHistory: () => void
  dismissActionToast: () => void
  acceptPendingFact: (fact: PendingFact) => Promise<void>
  dismissPendingFact: (fact: PendingFact) => void
}

const AIEngineContext = createContext<AIEngineContextValue | null>(null)

const HISTORY_TURNS = 4 // last N user+assistant turns folded into the prompt
const PANTRY_TOP_K = 10
const RECIPES_TOP_K = 8
const MEMORY_TOP_K = 5
const RETRIEVED_CHUNKS_K = 2
const FACT_EXTRACTOR_DEBOUNCE_MS = 2000

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
  const [pendingFacts, setPendingFacts] = useState<PendingFact[]>([])
  const [modelStatus, setModelStatus] = useState<OnDeviceLLMStatus>({
    isDownloaded: false,
    isDownloading: false,
    isLoaded: false,
    downloadProgress: 0,
  })

  // Single timer so rapid messages collapse to one extraction. Cleared if the
  // user sends another message before it fires.
  const factTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Single in-flight gate: only one LLM call runs at a time. The on-device
  // executorch instance is a singleton; concurrent generate() calls collide
  // and produce the "preparing/rebuilding" appearance the user observed.
  const llmBusyRef = useRef(false)

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

  const scheduleFactExtraction = useCallback(
    (userText: string, assistantText: string, memberId: string) => {
      if (factTimerRef.current) clearTimeout(factTimerRef.current)
      factTimerRef.current = setTimeout(async () => {
        factTimerRef.current = null
        // Bail if a user-facing generation is in flight — extraction must
        // never delay or contend with a real reply.
        if (llmBusyRef.current) return
        llmBusyRef.current = true
        try {
          const facts = await extractFactsFromTurn(userText, assistantText)
          if (facts.length === 0) return
          setPendingFacts((prev) => [
            ...prev,
            ...facts.map((f) => ({ text: f.text, category: f.category, memberId })),
          ])
        } catch (e) {
          console.warn('[AIEngine] fact extraction error:', e)
        } finally {
          llmBusyRef.current = false
        }
      }, FACT_EXTRACTOR_DEBOUNCE_MS)
    },
    []
  )

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

      // Topic gate short-circuit. Off-topic queries skip the LLM entirely:
      // keeps the assistant in scope and avoids burning ~1s of inference on
      // a refusal we already know we're going to give.
      if (classify(content) === 'out') {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId('msg'),
            role: 'assistant',
            content: getRefusalMessage(),
            timestamp: new Date().toISOString(),
            isStreaming: false,
            route: 'on_device',
          },
        ])
        return
      }

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
        // If a background fact extraction is mid-flight, cancel it: the user
        // has spoken, their reply must take priority over learning.
        if (factTimerRef.current) {
          clearTimeout(factTimerRef.current)
          factTimerRef.current = null
        }
        // Bypass the polled modelStatus.isLoaded — that flag lags by up to 5s
        // and was producing false negatives ("preparing…") on rapid second
        // turns. ensureModelAvailable is a no-op when the model is loaded.
        const ready = await ensureModelAvailable()
        if (!ready) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: t.ai.modelPreparingMessage, isStreaming: false }
                : m
            )
          )
          return
        }
        // Wait briefly if a previous LLM call is still running. The on-device
        // executorch instance is a singleton; concurrent generate() calls
        // collide. We wait up to ~10s before giving up.
        const waitStart = Date.now()
        while (llmBusyRef.current && Date.now() - waitStart < 10000) {
          await new Promise((r) => setTimeout(r, 100))
        }
        if (llmBusyRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: t.ai.modelPreparingMessage, isStreaming: false }
                : m
            )
          )
          return
        }
        llmBusyRef.current = true

        const activeMember = selectedId ? profiles.find((p) => p.id === selectedId) : undefined

        // Background reads: school menu (only for school-age members), recipes,
        // memories, query embedding, doc-chunk retrieval. All independent —
        // run in parallel so the prompt build doesn't add waterfall latency.
        const schoolAgeIds = profiles.filter((p) => p.isSchoolAge).map((p) => p.id)

        const [schoolMenuEntriesRaw, available, favoriteRecipes, memberMemories, queryEmbedding] =
          await Promise.all([
            Promise.all(schoolAgeIds.map((id) => getSchoolMenuEntries(id))).then((arr) =>
              arr.flat().map((e) => ({ ...e, meal: 'lunch' as const }))
            ),
            getAllRecipes(40, 0),
            (async () => {
              const ids = activeMember?.favoriteRecipeIds ?? []
              return ids.length > 0 ? await getRecipesByIds(ids) : []
            })(),
            activeMember
              ? getTopMemoriesForMember(activeMember.id, MEMORY_TOP_K)
              : Promise.resolve([]),
            embedTextOrNull(content),
          ])

        const recipeIndex = new Map<string, string>()
        for (const r of favoriteRecipes) recipeIndex.set(r.id, r.name)
        for (const r of available) recipeIndex.set(r.id, r.name)

        // Top-K relevance ranking instead of dumping everything. Fits the
        // 1B model's ~2k-token KV cache reliably.
        const topPantry = rankByKeywordOverlap(
          inventory,
          content,
          (i) => i.name,
          PANTRY_TOP_K
        )
        const topRecipes = rankByKeywordOverlap(
          available,
          content,
          (r) => r.name,
          RECIPES_TOP_K
        )
        const availableRecipes: RecipeRef[] = topRecipes.map((r) => ({ id: r.id, name: r.name }))

        const retrievedChunks: RetrievedDocChunk[] = activeMember
          ? (
              await retrievePdfChunks(activeMember.id, queryEmbedding, RETRIEVED_CHUNKS_K)
            ).map((c) => {
              const doc = activeMember.documents.find((d) => d.id === c.docId)
              return { text: c.text, filename: doc?.filename ?? c.docId }
            })
          : []

        const systemPrompt = buildSystemPrompt(
          profiles,
          topPantry,
          weekPlans,
          schoolMenuEntriesRaw.length ? schoolMenuEntriesRaw : undefined,
          {
            recipeIndex,
            availableRecipes,
            activeMemberId: selectedId ?? undefined,
            aboutMeNotes: activeMember?.aboutMeNotes,
            memberMemories: memberMemories.map((m) => m.text),
            retrievedChunks,
          }
        )

        const userPrompt = buildPromptWithHistory(messages, content)

        let fullText = ''
        await generateOnDevice(userPrompt, systemPrompt, (token) => {
          fullText += token
          // Hide Qwen 3's <think>…</think> chain-of-thought from the bubble
          // as it streams in. Stripping per-token keeps the user from ever
          // seeing the internal reasoning, even mid-stream.
          const display = stripThinkingBlock(fullText)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: display } : m
            )
          )
        })

        const { cleanText, actions } = parseActions(stripThinkingBlock(fullText))
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
            const first = actions[0]
            const member = profiles.find((p) => p.id === first.memberId)
            const recipeName = recipeIndex.get(first.recipeId)
            setLastActionToast(
              describeAction(first, { memberName: member?.name, recipeName })
            )
          }
        }

        // Schedule background fact extraction. Non-blocking: the user can keep
        // chatting; if facts come back, we surface them as a confirmation
        // banner (visibility before persistence).
        if (activeMember) {
          scheduleFactExtraction(content, cleanText, activeMember.id)
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
        llmBusyRef.current = false
        setIsResponding(false)
      }
    },
    [profiles, weekPlans, inventory, messages, applyAIActions, selectedId, scheduleFactExtraction]
  )

  const clearHistory = useCallback(() => {
    setMessages([])
  }, [])

  const dismissActionToast = useCallback(() => setLastActionToast(null), [])

  const acceptPendingFact = useCallback(async (fact: PendingFact) => {
    try {
      await addMemberMemory(fact.memberId, fact.text, fact.category)
    } catch (e) {
      console.warn('[AIEngine] failed to persist fact:', e)
    }
    setPendingFacts((prev) => prev.filter((f) => f !== fact))
  }, [])

  const dismissPendingFact = useCallback((fact: PendingFact) => {
    setPendingFacts((prev) => prev.filter((f) => f !== fact))
  }, [])

  // Auto-clear toast after 3.5s so it doesn't linger if the user doesn't
  // interact with the chat sheet again immediately.
  useEffect(() => {
    if (!lastActionToast) return
    const timer = setTimeout(() => setLastActionToast(null), 3500)
    return () => clearTimeout(timer)
  }, [lastActionToast])

  // Cleanup: cancel any pending fact extraction when the provider unmounts.
  useEffect(() => {
    return () => {
      if (factTimerRef.current) clearTimeout(factTimerRef.current)
    }
  }, [])

  return (
    <AIEngineContext.Provider
      value={{
        messages,
        isResponding,
        modelStatus,
        lastActionToast,
        pendingFacts,
        refreshModelStatus,
        sendMessage,
        clearHistory,
        dismissActionToast,
        acceptPendingFact,
        dismissPendingFact,
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
