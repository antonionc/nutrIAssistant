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
