import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '' })

// Translate up to 50 recipe names from English to Spanish in one call.
// Input:  [{ id, name }]
// Output: Map of id → Spanish name (missing entries = translation failed for that item)
export async function translateRecipeNames(
  recipes: { id: string; name: string }[]
): Promise<Map<string, string>> {
  if (recipes.length === 0) return new Map()

  const list = recipes.map((r) => `${r.id}\t${r.name}`).join('\n')
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content:
        'Translate these recipe names from English to Spanish. ' +
        'Return ONLY one line per recipe in the exact same tab-separated format ' +
        '"ID\\tSpanish name". No explanations, no extra lines.\n\n' + list,
    }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const result = new Map<string, string>()
  for (const line of text.trim().split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const id   = line.slice(0, tab).trim()
    const name = line.slice(tab + 1).trim()
    if (id && name) result.set(id, name)
  }
  return result
}

// Translate an array of cooking instruction steps from English to Spanish.
// Preserves the number of steps.
export async function translateInstructions(instructions: string[]): Promise<string[]> {
  if (instructions.length === 0) return []

  const numbered = instructions.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content:
        'Translate these cooking instructions from English to Spanish. ' +
        'Return ONLY the translated steps, one per line, numbered "N. step". ' +
        'No extra text.\n\n' + numbered,
    }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return text
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
}
