// Pin the locale to Spanish: this suite asserts the Spanish wording of the
// guardrail and section labels. expo-localization in jest-expo defaults to
// the host's locale (often `en`), which would break these assertions.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'es' }],
}))

import { buildSystemPrompt, buildMealPlanGenerationPrompt, InventoryLite } from '../../../services/prompts/system'
import { FamilyMember } from '../../../types/profiles'

const makeMember = (overrides: Partial<FamilyMember> = {}): FamilyMember => ({
  id: 'mem-1',
  name: 'Ana',
  role: 'mother',
  dateOfBirth: '1985-06-15',
  weight: 65,
  height: 168,
  allergies: [],
  conditions: [],
  dietPreference: 'none',
  isSchoolAge: false,
  favoriteRecipeIds: [],
  documents: [],
  isSuperUser: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

const sampleInventory: InventoryLite[] = [
  { name: 'chicken breast', quantity: 400, unit: 'g' },
  { name: 'olive oil', quantity: 1, unit: 'bottle' },
]

// ─── Guard: no hardcoded test-fixture family names ────────────────────────────

describe('buildSystemPrompt — no hardcoded Potter family', () => {
  it('does not contain "Harry" in any casing', () => {
    const prompt = buildSystemPrompt([makeMember()], [])
    expect(prompt).not.toMatch(/\bHarry\b/i)
  })

  it('does not contain "Ginny" in any casing', () => {
    const prompt = buildSystemPrompt([makeMember()], [])
    expect(prompt).not.toMatch(/\bGinny\b/i)
  })

  it('does not contain "Potter" in any casing', () => {
    const prompt = buildSystemPrompt([makeMember()], [])
    expect(prompt).not.toMatch(/\bPotter\b/i)
  })
})

// ─── Dynamic profile directives ───────────────────────────────────────────────

describe('buildSystemPrompt — topic guardrail and scoping', () => {
  it('always includes the strict-scope topic directive', () => {
    const prompt = buildSystemPrompt([makeMember()], [])
    expect(prompt).toMatch(/ÁMBITO ESTRICTO/)
    expect(prompt).toMatch(/nutrición.*alimentación.*salud.*comidas.*compras/)
  })

  it('includes a few-shot example of refusing an off-topic question', () => {
    const prompt = buildSystemPrompt([makeMember()], [])
    expect(prompt).toMatch(/Ejemplo:/)
    expect(prompt).toMatch(/Soy NutriBot, así que solo puedo ayudarte/)
  })

  it('with activeMemberId, scopes the PERFIL section to that member only', () => {
    const members = [
      makeMember({ id: 'a', name: 'Alice' }),
      makeMember({ id: 'b', name: 'Bob' }),
    ]
    const prompt = buildSystemPrompt(members, [], undefined, undefined, { activeMemberId: 'a' })
    expect(prompt).toContain('Alice')
    expect(prompt).not.toContain('Bob')
  })

  it('injects About-me notes when provided', () => {
    const member = makeMember({ id: 'a', name: 'Alice' })
    const prompt = buildSystemPrompt([member], [], undefined, undefined, {
      activeMemberId: 'a',
      aboutMeNotes: 'Soy intolerante al picante',
    })
    expect(prompt).toMatch(/SOBRE MÍ/)
    expect(prompt).toContain('Soy intolerante al picante')
  })

  it('injects extracted member memories when provided', () => {
    const member = makeMember({ id: 'a', name: 'Alice' })
    const prompt = buildSystemPrompt([member], [], undefined, undefined, {
      activeMemberId: 'a',
      memberMemories: ['Entrena 4 veces por semana', 'No le gusta el cilantro'],
    })
    expect(prompt).toMatch(/RECUERDOS/)
    expect(prompt).toContain('Entrena 4 veces por semana')
  })

  it('injects retrieved doc chunks with filename attribution', () => {
    const member = makeMember({ id: 'a', name: 'Alice' })
    const prompt = buildSystemPrompt([member], [], undefined, undefined, {
      activeMemberId: 'a',
      retrievedChunks: [{ filename: 'analitica.pdf', text: 'Glucosa: 110 mg/dl' }],
    })
    expect(prompt).toMatch(/DOCUMENTOS MÉDICOS RELEVANTES/)
    expect(prompt).toContain('analitica.pdf')
    expect(prompt).toContain('Glucosa: 110 mg/dl')
  })

  it('hard-caps the prompt length to stay under the 1B model context budget', () => {
    const members = Array.from({ length: 8 }, (_, i) =>
      makeMember({ id: `m${i}`, name: `Member${i}`, conditions: ['hypertension'] })
    )
    const inv: InventoryLite[] = Array.from({ length: 100 }, (_, i) => ({
      name: `item${i} with a moderately long name`,
      quantity: 1,
      unit: 'g',
    }))
    const prompt = buildSystemPrompt(members, inv)
    // PROMPT_HARD_CAP_CHARS is 4500; allow a little slack for the suffix.
    expect(prompt.length).toBeLessThanOrEqual(4500)
  })
})

describe('buildSystemPrompt — dynamic content', () => {
  it('embeds the actual member name when they have a condition', () => {
    const member = makeMember({ name: 'Pedro', conditions: ['hypertension'] })
    const prompt = buildSystemPrompt([member], [])
    expect(prompt).toContain('Pedro')
  })

  it('includes hypertension guidance with sodium restriction', () => {
    const member = makeMember({ conditions: ['hypertension'] })
    const prompt = buildSystemPrompt([member], [])
    expect(prompt).toMatch(/sodio|sodium/i)
  })

  it('includes osteoporosis guidance with calcium/vitamin D', () => {
    const member = makeMember({ conditions: ['osteoporosis'] })
    const prompt = buildSystemPrompt([member], [])
    expect(prompt).toMatch(/calcio|calcium|vitamina D/i)
  })

  it('produces no condition directives when member has no conditions', () => {
    const prompt = buildSystemPrompt([makeMember({ conditions: [] })], [])
    expect(prompt).not.toMatch(/hypertension|osteoporosis|diabetes|celiac/i)
  })

  it('includes inventory item names when inventory is provided', () => {
    const prompt = buildSystemPrompt([makeMember()], sampleInventory)
    expect(prompt).toContain('chicken breast')
    expect(prompt).toContain('olive oil')
  })

  it('works correctly with multiple members having different conditions', () => {
    const members = [
      makeMember({ id: 'a', name: 'Alice', conditions: ['hypertension'] }),
      makeMember({ id: 'b', name: 'Bob', conditions: ['osteoporosis'] }),
    ]
    const prompt = buildSystemPrompt(members, [])
    expect(prompt).toContain('Alice')
    expect(prompt).toContain('Bob')
  })

  it('does not throw with empty profiles and empty inventory', () => {
    expect(() => buildSystemPrompt([], [])).not.toThrow()
  })

  it('embeds USUARIO ACTIVO directive when activeMemberId resolves to a member', () => {
    const members = [
      makeMember({ id: 'a', name: 'Alice' }),
      makeMember({ id: 'b', name: 'Bob' }),
    ]
    const prompt = buildSystemPrompt(members, [], undefined, undefined, { activeMemberId: 'b' })
    expect(prompt).toContain('USUARIO ACTIVO')
    expect(prompt).toContain('Bob')
  })

  it('omits USUARIO ACTIVO when activeMemberId is missing or unknown', () => {
    const members = [makeMember({ id: 'a', name: 'Alice' })]
    expect(buildSystemPrompt(members, [])).not.toContain('USUARIO ACTIVO')
    expect(
      buildSystemPrompt(members, [], undefined, undefined, { activeMemberId: 'ghost' })
    ).not.toContain('USUARIO ACTIVO')
  })
})

// ─── buildMealPlanGenerationPrompt ───────────────────────────────────────────

describe('buildMealPlanGenerationPrompt — no hardcoded Potter family', () => {
  it('does not contain "Potter"', () => {
    const prompt = buildMealPlanGenerationPrompt([makeMember()], [])
    expect(prompt).not.toMatch(/\bPotter\b/i)
  })

  it('does not contain "Harry"', () => {
    expect(buildMealPlanGenerationPrompt([makeMember()], [])).not.toMatch(/\bHarry\b/i)
  })

  it('does not contain "Ginny"', () => {
    expect(buildMealPlanGenerationPrompt([makeMember()], [])).not.toMatch(/\bGinny\b/i)
  })

  it('does not contain "James" as a hardcoded person (James=tree nuts)', () => {
    expect(buildMealPlanGenerationPrompt([makeMember()], [])).not.toContain('James=tree nuts')
  })

  it('does not contain "Lily" as a hardcoded person (Lily=dairy)', () => {
    expect(buildMealPlanGenerationPrompt([makeMember()], [])).not.toContain('Lily=dairy')
  })
})

describe('buildMealPlanGenerationPrompt — dynamic content', () => {
  it('includes the actual member allergens in the output', () => {
    const member = makeMember({ name: 'Sofia', allergies: ['peanuts', 'gluten'] })
    const prompt = buildMealPlanGenerationPrompt([member], [])
    expect(prompt).toContain('peanuts')
    expect(prompt).toContain('gluten')
  })

  it('includes the member name next to their allergen list', () => {
    const member = makeMember({ name: 'Carlos', allergies: ['dairy'] })
    const prompt = buildMealPlanGenerationPrompt([member], [])
    expect(prompt).toContain('Carlos')
  })

  it('includes pantry items from inventory', () => {
    const prompt = buildMealPlanGenerationPrompt([makeMember()], sampleInventory)
    expect(prompt).toContain('chicken breast')
  })

  it('uses the provided startDate in the prompt', () => {
    const prompt = buildMealPlanGenerationPrompt([makeMember()], [], undefined, '2026-06-01')
    expect(prompt).toContain('2026-06-01')
  })

  it('preserves the required JSON output format specification', () => {
    const prompt = buildMealPlanGenerationPrompt([makeMember()], [])
    expect(prompt).toContain('"date":"YYYY-MM-DD"')
    expect(prompt).toContain('"breakfast"')
    expect(prompt).toContain('"lunch"')
    expect(prompt).toContain('"dinner"')
    expect(prompt).toContain('"calories"')
  })

  it('outputs no allergen constraint line when no members have allergies', () => {
    const prompt = buildMealPlanGenerationPrompt([makeMember({ allergies: [] })], [])
    expect(prompt).not.toMatch(/allergies:\s*\S/)
  })
})
