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

const ACTIONS_RE = /<actions>([\s\S]*?)<\/actions>/i

function isValidAction(raw: unknown): raw is AIAction {
  if (!raw || typeof raw !== 'object') return false
  const a = raw as Record<string, unknown>
  if (typeof a.memberId !== 'string' || !a.memberId) return false
  if (typeof a.recipeId !== 'string' || !a.recipeId) return false
  return a.type === 'add_favorite' || a.type === 'remove_favorite'
}

export function parseActions(text: string): ParsedAIResponse {
  const match = text.match(ACTIONS_RE)
  if (!match) return { cleanText: text, actions: [] }

  const cleanText = text.replace(ACTIONS_RE, '').trim()
  const inner = match[1].trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(inner)
  } catch {
    return { cleanText, actions: [] }
  }

  const list = Array.isArray(parsed) ? parsed : [parsed]
  const actions = list.filter(isValidAction)
  return { cleanText, actions }
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
