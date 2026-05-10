import { parseActions, stripThinkingBlock } from '../../services/aiActions'

describe('parseActions', () => {
  const validJson = '[{"type":"add_favorite","memberId":"m-1","recipeId":"r-1"}]'

  it('returns text untouched when no actions are present', () => {
    const r = parseActions('Te recomiendo unas lentejas con verduras.')
    expect(r.cleanText).toBe('Te recomiendo unas lentejas con verduras.')
    expect(r.actions).toEqual([])
  })

  it('extracts the canonical <actions>…</actions> block and strips it', () => {
    const r = parseActions(`Receta lista. <actions>${validJson}</actions>`)
    expect(r.cleanText).toBe('Receta lista.')
    expect(r.actions).toEqual([{ type: 'add_favorite', memberId: 'm-1', recipeId: 'r-1' }])
  })

  it('falls back when the model uses an "Acciones:" header (no tags)', () => {
    const text = `Aquí tienes una tarta sencilla.\n\nAcciones:\n\n${validJson}`
    const r = parseActions(text)
    expect(r.cleanText).toBe('Aquí tienes una tarta sencilla.')
    expect(r.actions).toHaveLength(1)
  })

  it('also accepts the English "Actions:" header', () => {
    const text = `Here is a quick cake recipe.\n\nActions:\n${validJson}`
    const r = parseActions(text)
    expect(r.cleanText).toBe('Here is a quick cake recipe.')
    expect(r.actions).toHaveLength(1)
  })

  it('falls back to a bare trailing JSON array even with no header at all', () => {
    const text = `Receta añadida.\n\n${validJson}`
    const r = parseActions(text)
    expect(r.cleanText).toBe('Receta añadida.')
    expect(r.actions).toHaveLength(1)
  })

  it('does not strip arbitrary trailing JSON that contains zero valid actions', () => {
    const text = 'Aquí va el plan. [{"foo":"bar"}]'
    const r = parseActions(text)
    // Must NOT lose the user-visible "[…]" — model didn't emit a real action
    expect(r.cleanText).toBe(text)
    expect(r.actions).toEqual([])
  })

  it('drops malformed action items but keeps valid ones', () => {
    const mixed =
      '[{"type":"add_favorite","memberId":"m-1","recipeId":"r-1"},{"type":"unknown","memberId":"m-2","recipeId":"r-2"}]'
    const r = parseActions(`Listo. <actions>${mixed}</actions>`)
    expect(r.actions).toHaveLength(1)
    expect(r.actions[0].type).toBe('add_favorite')
  })

  it('handles invalid JSON inside <actions> tags gracefully', () => {
    const r = parseActions('Listo. <actions>not json</actions>')
    expect(r.cleanText).toBe('Listo.')
    expect(r.actions).toEqual([])
  })
})

describe('stripThinkingBlock', () => {
  it('returns plain text untouched', () => {
    expect(stripThinkingBlock('Hola, esto es una receta.')).toBe('Hola, esto es una receta.')
  })

  it('removes a closed <think>…</think> block (Qwen 3 chain-of-thought)', () => {
    const input = `<think>
The user wants a cake recipe in Spanish, concise.
</think>

Sí, te recomiendo un bizcocho de yogur.`
    expect(stripThinkingBlock(input)).toBe('Sí, te recomiendo un bizcocho de yogur.')
  })

  it('removes a dangling <think> with no closing tag (mid-stream)', () => {
    const input = '<think>thinking about'
    expect(stripThinkingBlock(input)).toBe('')
  })

  it('removes multiple think blocks if the model emits more than one', () => {
    const input = '<think>a</think>Hola<think>b</think>mundo'
    expect(stripThinkingBlock(input)).toBe('Holamundo')
  })
})
