import { generateOnDevice, getLLMStatus } from './onDeviceLlm'

const TRANSLATION_SYSTEM_PROMPT =
  'You are a precise EN→ES (Spain) translator for cooking content. ' +
  'Output ONLY the requested format. No explanations, no extra lines, no markdown.'

async function isModelReady(): Promise<boolean> {
  try {
    const status = await getLLMStatus()
    return status.isLoaded
  } catch {
    return false
  }
}

// Translate up to 50 recipe names from English to Spanish in one call.
// Input:  [{ id, name }]
// Output: Map of id → Spanish name (empty map if model isn't loaded yet,
//         caller is expected to retry later).
export async function translateRecipeNames(
  recipes: { id: string; name: string }[]
): Promise<Map<string, string>> {
  if (recipes.length === 0) return new Map()
  if (!(await isModelReady())) return new Map()

  const list = recipes.map((r) => `${r.id}\t${r.name}`).join('\n')
  const userPrompt =
    'Translate these recipe names from English to Spanish (Spain). ' +
    'Return ONLY one line per recipe in the exact same tab-separated format ' +
    '"ID\\tSpanish name". Preserve every ID exactly. No explanations, no extra lines.\n\n' + list

  let raw: string
  try {
    raw = await generateOnDevice(userPrompt, TRANSLATION_SYSTEM_PROMPT)
  } catch {
    return new Map()
  }

  const result = new Map<string, string>()
  for (const line of raw.trim().split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const id = line.slice(0, tab).trim()
    const name = line.slice(tab + 1).trim()
    if (id && name) result.set(id, name)
  }
  return result
}

// Translate cooking instruction steps from English to Spanish.
// Returns the steps in the same order, or [] if the model isn't loaded.
export async function translateInstructions(instructions: string[]): Promise<string[]> {
  if (instructions.length === 0) return []
  if (!(await isModelReady())) return []

  const numbered = instructions.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const userPrompt =
    'Translate these cooking instructions from English to Spanish (Spain). ' +
    'Return ONLY the translated steps, one per line, numbered "N. step". ' +
    'Preserve the number of steps. No extra text.\n\n' + numbered

  let raw: string
  try {
    raw = await generateOnDevice(userPrompt, TRANSLATION_SYSTEM_PROMPT)
  } catch {
    return []
  }

  return raw
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
}
