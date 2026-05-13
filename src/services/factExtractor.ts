import { generateOnDevice } from './onDeviceLlm'
import { MemoryCategory } from './memoryStore'
import { currentLang } from '../utils/locale'
import { logger } from '../utils/logger'

// Background pass that asks the LLM to extract durable facts from the most
// recent user/assistant exchange. Designed to be:
//   - cheap (one LLM call, ≤200 token output)
//   - safe (constrained JSON, validated; failure is silent)
//   - non-blocking (caller schedules it; never awaited from UI critical path)
//   - debounced (one outstanding call at a time per member)

export interface CandidateFact {
  text: string
  category: MemoryCategory
}

const SYSTEM_PROMPT_ES = `/no_think
Eres un extractor de hechos. Lee la conversación y extrae HASTA 3 hechos duraderos sobre el usuario que valga la pena recordar (preferencias, condiciones de salud, rutinas, restricciones). NO extraigas datos efímeros (lo que comió hoy, una pregunta puntual). Cada hecho debe ser corto, factual y en tercera persona, escrito en español.

Responde EXCLUSIVAMENTE con JSON válido en este formato exacto, sin texto adicional:
{"facts":[{"text":"...","category":"preference|health|routine|other"}]}

Si no hay hechos duraderos, responde: {"facts":[]}`

const SYSTEM_PROMPT_EN = `/no_think
You are a fact extractor. Read the conversation and extract UP TO 3 durable facts about the user that are worth remembering (preferences, health conditions, routines, restrictions). DO NOT extract ephemeral data (what they ate today, a one-off question). Each fact should be short, factual and in the third person, written in English.

Respond EXCLUSIVELY with valid JSON in this exact format, no extra text:
{"facts":[{"text":"...","category":"preference|health|routine|other"}]}

If there are no durable facts, respond: {"facts":[]}`

const MAX_FACTS = 3
const MAX_FACT_LEN = 120

let inflight: Promise<CandidateFact[]> | null = null

function clipFacts(parsed: unknown): CandidateFact[] {
  if (!parsed || typeof parsed !== 'object') return []
  const facts = (parsed as { facts?: unknown }).facts
  if (!Array.isArray(facts)) return []
  const out: CandidateFact[] = []
  for (const f of facts) {
    if (out.length >= MAX_FACTS) break
    if (!f || typeof f !== 'object') continue
    const text = String((f as { text?: unknown }).text ?? '').trim()
    const category = String((f as { category?: unknown }).category ?? 'other')
    if (!text) continue
    if (!['preference', 'health', 'routine', 'other'].includes(category)) continue
    out.push({
      text: text.slice(0, MAX_FACT_LEN),
      category: category as MemoryCategory,
    })
  }
  return out
}

function tryParseJson(raw: string): unknown {
  // Models occasionally wrap JSON in prose / code fences. Pull the first {…}
  // block with a non-greedy match so we don't fail on minor formatting drift.
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

export async function extractFactsFromTurn(
  userText: string,
  assistantText: string
): Promise<CandidateFact[]> {
  // Single-flight: if a previous extraction is still running, return that.
  // Prevents stacking expensive 1B-model calls when the user is sending
  // messages quickly.
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const lang = currentLang()
      const userLabel = lang === 'en' ? 'User' : 'Usuario'
      const assistantLabel = lang === 'en' ? 'Assistant' : 'Asistente'
      const exchange = `${userLabel}: ${userText.slice(0, 600)}\n${assistantLabel}: ${assistantText.slice(0, 600)}`
      const systemPrompt = lang === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_ES
      const raw = await generateOnDevice(exchange, systemPrompt)
      return clipFacts(tryParseJson(raw))
    } catch (e) {
      logger.warn('[factExtractor] extraction failed:', e)
      return []
    } finally {
      inflight = null
    }
  })()
  return inflight
}
