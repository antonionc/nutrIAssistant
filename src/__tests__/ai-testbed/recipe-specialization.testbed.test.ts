/**
 * AI TESTBED — Recipe & nutrition-plan specialization
 * ─────────────────────────────────────────────────────────────────────────────
 * Proposing recipes and weekly nutritional plans is NutriBot's headline use
 * case. This suite verifies the assistant is steered to produce well-formed,
 * allergen-safe culinary output:
 *   1. The chat system prompt instructs a recipe/plan format (ingredients with
 *      quantities, steps, calorie + macro estimate) and an allergen check.
 *   2. The meal-plan generation prompt encodes allergen safety, medical
 *      conditions, protein variety and the strict JSON contract.
 *   3. The <actions> protocol that lets the model favorite/unfavorite a
 *      recipe parses robustly and never crashes on a hallucinated payload.
 *
 * Run via `npm run testbed`. See ./README.md for when to re-run.
 */
import { buildSystemPrompt, buildMealPlanGenerationPrompt } from '../../services/prompts/system'
import { parseActions } from '../../services/aiActions'
import { FamilyMember } from '../../types/profiles'

// Swappable locale so the recipe directive can be checked in ES and EN. The
// mock factory is lazy (it only reads `mockLocale` when getLocales is called
// inside a test), so declaring it after the imports is safe.
const mockLocale = { code: 'es' }
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: mockLocale.code }],
}))

const makeMember = (o: Partial<FamilyMember> = {}): FamilyMember => ({
  id: 'mem-1', name: 'Ana', role: 'mother', dateOfBirth: '1985-06-15', weight: 65, height: 168,
  allergies: [], conditions: [], dietPreference: 'none', isSchoolAge: false,
  favoriteRecipeIds: [], documents: [], isSuperUser: false,
  createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z', ...o,
})

afterEach(() => {
  mockLocale.code = 'es'
})

// ─── 1. Chat system prompt steers recipe / plan answers ──────────────────────

describe('Recipe specialization · system prompt recipe directive (ES)', () => {
  it('asks for ingredients with quantities and brief steps', () => {
    const p = buildSystemPrompt([makeMember()], [])
    expect(p).toMatch(/ingredientes con cantidades/i)
    expect(p).toMatch(/pasos/i)
  })
  it('asks for a calorie and macro estimate per serving', () => {
    const p = buildSystemPrompt([makeMember()], [])
    expect(p).toMatch(/calor/i)
    expect(p).toMatch(/proteína\/carbohidratos\/grasa/i)
  })
  it('keeps the allergen-safety guardrail on every recipe answer', () => {
    const p = buildSystemPrompt([makeMember()], [])
    expect(p).toMatch(/alérgenos/i)
  })
})

describe('Recipe specialization · system prompt recipe directive (EN)', () => {
  it('asks for ingredients, steps and a macro estimate in English', () => {
    mockLocale.code = 'en'
    const p = buildSystemPrompt([makeMember()], [])
    expect(p).toMatch(/ingredients with per-serving quantities/i)
    expect(p).toMatch(/numbered steps/i)
    expect(p).toMatch(/protein\/carbs\/fat/i)
  })
})

describe('Recipe specialization · candidate recipes are offered to the model', () => {
  it('lists AVAILABLE RECIPES with ids the model may favorite', () => {
    const p = buildSystemPrompt([makeMember({ id: 'a' })], [], undefined, undefined, {
      activeMemberId: 'a',
      availableRecipes: [
        { id: 'r-1', name: 'Lentejas estofadas' },
        { id: 'r-2', name: 'Salmón al horno' },
      ],
    })
    expect(p).toMatch(/RECETAS DISPONIBLES/)
    expect(p).toContain('Lentejas estofadas')
    expect(p).toContain('r-2')
  })

  it('reflects the active member allergies and conditions in PERFIL', () => {
    const p = buildSystemPrompt(
      [makeMember({ id: 'a', allergies: ['peanuts'], conditions: ['celiac'] })],
      [],
      undefined,
      undefined,
      { activeMemberId: 'a' }
    )
    expect(p).toContain('peanuts')
    expect(p).toContain('celiac')
  })
})

// ─── 2. Meal-plan generation prompt ──────────────────────────────────────────

describe('Recipe specialization · weekly meal-plan generation prompt', () => {
  it('constrains every meal to be safe for all members allergies', () => {
    const p = buildMealPlanGenerationPrompt(
      [makeMember({ name: 'Sofia', allergies: ['peanuts', 'gluten'] })],
      []
    )
    expect(p).toMatch(/safe for ALL family members/i)
    expect(p).toContain('peanuts')
    expect(p).toContain('gluten')
  })

  it('injects medical-condition guidance into the plan constraints', () => {
    // CONDITION_GUIDANCE is a fixed Spanish map (system.ts) — hypertension
    // yields a "limitar sodio…" directive regardless of UI locale.
    const p = buildMealPlanGenerationPrompt([makeMember({ conditions: ['hypertension'] })], [])
    expect(p).toMatch(/sodio/i)
  })

  it('enforces protein variety across the week', () => {
    const p = buildMealPlanGenerationPrompt([makeMember()], [])
    expect(p).toMatch(/No protein source.*more than twice/i)
  })

  it('emits a Mediterranean-baseline instruction', () => {
    expect(buildMealPlanGenerationPrompt([makeMember()], [])).toMatch(/Mediterranean/i)
  })

  it('locks the strict JSON output contract', () => {
    const p = buildMealPlanGenerationPrompt([makeMember()], [])
    expect(p).toContain('"date":"YYYY-MM-DD"')
    expect(p).toContain('"calories"')
    expect(p).toContain('"protein"')
  })
})

// ─── 3. Recipe favorite/unfavorite action protocol ───────────────────────────

describe('Recipe specialization · <actions> protocol robustness', () => {
  it('parses a canonical add_favorite action and strips it from the reply', () => {
    const reply =
      'Te recomiendo unas lentejas estofadas. <actions>[{"type":"add_favorite","memberId":"m-1","recipeId":"r-1"}]</actions>'
    const r = parseActions(reply)
    expect(r.cleanText).toBe('Te recomiendo unas lentejas estofadas.')
    expect(r.actions).toEqual([{ type: 'add_favorite', memberId: 'm-1', recipeId: 'r-1' }])
  })

  it('parses a remove_favorite action', () => {
    const r = parseActions(
      'Hecho. <actions>[{"type":"remove_favorite","memberId":"m-1","recipeId":"r-9"}]</actions>'
    )
    expect(r.actions[0].type).toBe('remove_favorite')
  })

  it('recovers an "Acciones:" header the model emitted without tags', () => {
    const r = parseActions(
      'Añadida a favoritos.\n\nAcciones:\n[{"type":"add_favorite","memberId":"m-1","recipeId":"r-1"}]'
    )
    expect(r.cleanText).toBe('Añadida a favoritos.')
    expect(r.actions).toHaveLength(1)
  })

  it('never crashes or drops text on a hallucinated payload', () => {
    const r = parseActions('Aquí va tu plan. [{"foo":"bar"}]')
    expect(r.cleanText).toBe('Aquí va tu plan. [{"foo":"bar"}]')
    expect(r.actions).toEqual([])
  })

  it('drops malformed action items but keeps the valid ones', () => {
    const r = parseActions(
      'Listo. <actions>[{"type":"add_favorite","memberId":"m-1","recipeId":"r-1"},{"type":"bogus"}]</actions>'
    )
    expect(r.actions).toHaveLength(1)
    expect(r.actions[0].type).toBe('add_favorite')
  })
})
