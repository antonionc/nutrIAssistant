/**
 * AI TESTBED — Prompt assembly & preference adherence
 * ─────────────────────────────────────────────────────────────────────────────
 * The on-device model only "knows" what the prompt builder hands it. This
 * suite verifies that every personalization signal the user gave us actually
 * reaches the model, and that the prompt stays coherent and bounded:
 *   1. Preference signals — about-me notes, ranked durable memories, retrieved
 *      clinical-PDF chunks — are all injected.
 *   2. Medical conditions translate into concrete dietary guidance.
 *   3. The prompt is scoped to the ACTIVE member (no cross-family leakage).
 *   4. The prompt is single-language (a mixed ES/EN prompt is a regression)
 *      and never exceeds the context budget.
 *
 * Run via `npm run testbed`. See ./README.md for when to re-run.
 */
import { buildSystemPrompt, InventoryLite } from '../../services/prompts/system'
import { FamilyMember } from '../../types/profiles'

// Swappable locale so prompt-language coherence can be checked in ES and EN.
// The mock factory is lazy (it only reads `mockLocale` when getLocales is
// actually called inside a test), so declaring it after the imports is safe.
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

// ─── 1. Preference signals reach the model ───────────────────────────────────

describe('Prompt assembly · personalization signals are injected', () => {
  it('injects the active member about-me notes', () => {
    const p = buildSystemPrompt([makeMember({ id: 'a' })], [], undefined, undefined, {
      activeMemberId: 'a',
      aboutMeNotes: 'Entreno 4 veces por semana y prefiero cenas ligeras',
    })
    expect(p).toMatch(/SOBRE MÍ/)
    expect(p).toContain('prefiero cenas ligeras')
  })

  it('injects the query-ranked durable memories', () => {
    const p = buildSystemPrompt([makeMember({ id: 'a' })], [], undefined, undefined, {
      activeMemberId: 'a',
      memberMemories: ['No le gusta el cilantro', 'Intolerante a la lactosa'],
    })
    expect(p).toMatch(/RECUERDOS/)
    expect(p).toContain('No le gusta el cilantro')
    expect(p).toContain('Intolerante a la lactosa')
  })

  it('injects retrieved clinical-PDF chunks with filename attribution', () => {
    const p = buildSystemPrompt([makeMember({ id: 'a' })], [], undefined, undefined, {
      activeMemberId: 'a',
      retrievedChunks: [
        { filename: 'analitica_2026.pdf', text: 'Vitamina D baja (16 ng/mL); LDL ligeramente alto.' },
      ],
    })
    expect(p).toMatch(/DOCUMENTOS MÉDICOS RELEVANTES/)
    expect(p).toContain('analitica_2026.pdf')
    expect(p).toContain('Vitamina D baja')
  })

  it('caps an over-long about-me note so it cannot blow the budget', () => {
    const p = buildSystemPrompt([makeMember({ id: 'a' })], [], undefined, undefined, {
      activeMemberId: 'a',
      aboutMeNotes: 'x'.repeat(1000),
    })
    // Truncated to 200 chars (+ ellipsis) — the raw 1000-char run never lands.
    expect(p).not.toContain('x'.repeat(300))
  })
})

// ─── 2. Medical conditions → concrete dietary guidance ───────────────────────

describe('Prompt assembly · medical conditions become dietary directives', () => {
  it('hypertension → sodium restriction', () => {
    expect(buildSystemPrompt([makeMember({ conditions: ['hypertension'] })], [])).toMatch(/sodio/i)
  })
  it('type-2 diabetes → glycemic-index control', () => {
    expect(buildSystemPrompt([makeMember({ conditions: ['diabetes_type2'] })], [])).toMatch(/glucémic/i)
  })
  it('celiac → strict gluten avoidance', () => {
    expect(buildSystemPrompt([makeMember({ conditions: ['celiac'] })], [])).toMatch(/gluten/i)
  })
  it('osteoporosis → calcium / vitamin D', () => {
    expect(buildSystemPrompt([makeMember({ conditions: ['osteoporosis'] })], [])).toMatch(/calcio/i)
  })
  it('no conditions → no condition directives leak in', () => {
    expect(buildSystemPrompt([makeMember({ conditions: [] })], [])).not.toMatch(/hypertension|celiac/i)
  })
})

// ─── 3. Active-member scoping (no cross-family leakage) ──────────────────────

describe('Prompt assembly · prompt is scoped to the active member', () => {
  it('includes only the active member, not the rest of the family', () => {
    const family = [
      makeMember({ id: 'a', name: 'Alicia' }),
      makeMember({ id: 'b', name: 'Bruno' }),
      makeMember({ id: 'c', name: 'Carla' }),
    ]
    const p = buildSystemPrompt(family, [], undefined, undefined, { activeMemberId: 'a' })
    expect(p).toContain('Alicia')
    expect(p).not.toContain('Bruno')
    expect(p).not.toContain('Carla')
  })

  it('marks the active user so the model addresses them directly', () => {
    const p = buildSystemPrompt([makeMember({ id: 'a', name: 'Alicia' })], [], undefined, undefined, {
      activeMemberId: 'a',
    })
    expect(p).toMatch(/USUARIO ACTIVO/)
  })
})

// ─── 4. Coherence & bounds ───────────────────────────────────────────────────

describe('Prompt assembly · safety invariants', () => {
  it('always starts with the /no_think directive (no CoT leakage)', () => {
    expect(buildSystemPrompt([makeMember()], []).startsWith('/no_think')).toBe(true)
  })

  it('never exceeds the 4500-char context budget', () => {
    const family = Array.from({ length: 8 }, (_, i) =>
      makeMember({ id: `m${i}`, name: `Miembro${i}`, conditions: ['hypertension'] })
    )
    const inventory: InventoryLite[] = Array.from({ length: 120 }, (_, i) => ({
      name: `ingrediente número ${i} con un nombre largo`, quantity: 1, unit: 'g',
    }))
    expect(buildSystemPrompt(family, inventory).length).toBeLessThanOrEqual(4500)
  })

  it('is single-language in Spanish locale (no English section labels)', () => {
    mockLocale.code = 'es'
    const p = buildSystemPrompt([makeMember()], [])
    expect(p).toMatch(/PERFIL/)
    expect(p).toMatch(/DESPENSA/)
    expect(p).not.toMatch(/\bPROFILE\b/)
    expect(p).not.toMatch(/\bPANTRY\b/)
  })

  it('is single-language in English locale (no Spanish section labels)', () => {
    mockLocale.code = 'en'
    const p = buildSystemPrompt([makeMember()], [])
    expect(p).toMatch(/PROFILE/)
    expect(p).toMatch(/PANTRY/)
    expect(p).not.toMatch(/PERFIL/)
    expect(p).not.toMatch(/DESPENSA/)
  })
})
