// Structured actions the on-device LLM may emit at the END of its response.
// Format: <actions>[{...}, ...]</actions>  (a single block, JSON array).
// Anything that doesn't strictly validate is dropped silently — the goal is
// to never crash on a hallucinated payload from a small mobile model.

export type AIAction =
  | { type: 'add_favorite'; memberId: string; recipeId: string }
  | { type: 'remove_favorite'; memberId: string; recipeId: string }

export interface ParsedAIResponse {
  cleanText: string
  actions: AIAction[]
}

// Primary expected form: <actions>[…]</actions>
const ACTIONS_RE = /<actions>([\s\S]*?)<\/actions>/i

// Fallback: the 1B model often forgets the tags and emits a bare "Acciones:"
// (or "Actions:") header followed by a JSON array, OR even just a trailing
// JSON array on its own line. We strip both so the user never sees the raw
// payload in the chat bubble.
const HEADER_FALLBACK_RE = /\n*\s*(?:acciones|actions)\s*:\s*\n+\s*(\[[\s\S]*?\])\s*$/i
const TRAILING_ARRAY_RE = /\n+\s*(\[\s*\{[\s\S]*?\}\s*\])\s*$/

// Qwen 3 emits chain-of-thought wrapped in <think>…</think> by default.
// We send `/no_think` in the system prompt to suppress it, but the model
// still occasionally leaks fragments — strip them defensively. Handles both
// the closed form and a never-closed dangling open tag (rare, but happens).
const THINK_RE = /<think>[\s\S]*?<\/think>/gi
const DANGLING_THINK_OPEN_RE = /<think>[\s\S]*$/i

export function stripThinkingBlock(text: string): string {
  return text.replace(THINK_RE, '').replace(DANGLING_THINK_OPEN_RE, '').trim()
}

function isValidAction(raw: unknown): raw is AIAction {
  if (!raw || typeof raw !== 'object') return false
  const a = raw as Record<string, unknown>
  if (typeof a.memberId !== 'string' || !a.memberId) return false
  if (typeof a.recipeId !== 'string' || !a.recipeId) return false
  return a.type === 'add_favorite' || a.type === 'remove_favorite'
}

function tryParseActionList(payload: string): AIAction[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  const actions = list.filter(isValidAction)
  // Reject lists that parsed as JSON but contained zero valid actions —
  // that's almost certainly unrelated JSON the model emitted (e.g. a
  // hallucinated recipe object). Returning null keeps the text intact.
  return actions.length > 0 ? actions : null
}

export function parseActions(text: string): ParsedAIResponse {
  // 1. Prefer the canonical <actions>...</actions> form.
  const tagged = text.match(ACTIONS_RE)
  if (tagged) {
    const actions = tryParseActionList(tagged[1].trim()) ?? []
    return { cleanText: text.replace(ACTIONS_RE, '').trim(), actions }
  }

  // 2. Fallback: "Acciones:\n[...]" header form.
  const headered = text.match(HEADER_FALLBACK_RE)
  if (headered) {
    const actions = tryParseActionList(headered[1])
    if (actions) {
      return { cleanText: text.replace(HEADER_FALLBACK_RE, '').trim(), actions }
    }
  }

  // 3. Last-resort: a bare JSON array of objects at the very end of the reply.
  const trailing = text.match(TRAILING_ARRAY_RE)
  if (trailing) {
    const actions = tryParseActionList(trailing[1])
    if (actions) {
      return { cleanText: text.replace(TRAILING_ARRAY_RE, '').trim(), actions }
    }
  }

  return { cleanText: text, actions: [] }
}

export function describeAction(
  action: AIAction,
  ctx: { memberName?: string; recipeName?: string }
): string {
  const member = ctx.memberName ?? 'el miembro'
  const recipe = ctx.recipeName ?? 'la receta'
  if (action.type === 'add_favorite') return `✔ Añadido ${recipe} a favoritos de ${member}`
  return `✔ Eliminado ${recipe} de favoritos de ${member}`
}
