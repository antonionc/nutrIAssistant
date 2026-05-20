/**
 * AI TESTBED — Security harness
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies the guardrails that keep NutriBot inside its mandate:
 *   1. Topic gate — only nutrition / food / health / meals / groceries reach
 *      the on-device LLM; obvious off-topic queries are hard-refused before a
 *      single token of inference is spent.
 *   2. Age gate — members under 18 (or unverifiable) can never reach the
 *      assistant.
 *   3. Refusal UX — the canned off-topic refusal is localized and on-brand.
 *
 * Run via `npm run testbed`. See ./README.md for when to re-run.
 */
import { classify, getRefusalMessage } from '../../services/topicGate'
import { isAIAccessibleForMember } from '../../modules/ai-engine/aiAccess'
import { FamilyMember } from '../../types/profiles'

// Swappable locale so the refusal copy can be checked in both languages.
const mockLocale = { code: 'es' }
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: mockLocale.code }],
}))

// ─── Corpora ─────────────────────────────────────────────────────────────────
// These lists are the security contract. Add a row whenever a real-world
// query slips through the wrong verdict — the corpus is the regression net.

const IN_SCOPE: string[] = [
  // Spanish
  '¿Qué puedo cocinar esta noche?',
  '¿Cuántas calorías tiene un aguacate?',
  'Necesito una receta sin gluten',
  '¿Es bueno el pescado para la tensión?',
  'Hazme un menú vegetariano para la semana',
  'Tengo el colesterol alto, ¿qué evito?',
  '¿Qué hay en mi despensa?',
  'Mi hijo es celíaco, ¿qué desayuno le doy?',
  '¿El café tiene muchas calorías?',
  'Plan de comidas para diabéticos',
  'Quiero perder peso de forma saludable',
  '¿Cuánta proteína necesito al día?',
  '¿Qué verduras son ricas en hierro?',
  'Ideas para la cena de los niños',
  'Receta con garbanzos y arroz',
  // English
  'What can I cook for dinner?',
  'How many calories are in an avocado?',
  'I need a gluten-free recipe',
  'Is fish good for blood pressure?',
  'Make me a vegetarian menu for the week',
  'My cholesterol is high, what should I avoid?',
  "What's in my pantry?",
  'My son is celiac, what breakfast can I give him?',
  'Meal plan for diabetics',
  'I want to lose weight in a healthy way',
  'How much protein do I need per day?',
  'Which vegetables are rich in iron?',
  'Snack ideas for the kids',
  'A recipe with chickpeas and rice',
]

const OUT_OF_SCOPE: string[] = [
  // Spanish
  'Escríbeme una función en JavaScript',
  '¿Cómo invierto en bitcoin?',
  'Recomiéndame una serie en Netflix',
  '¿Quién ganó la Champions League?',
  'Explícame el algoritmo de Dijkstra',
  'Háblame de las elecciones de Estados Unidos',
  '¿Qué tiempo hará mañana?',
  'Resuelve esta ecuación de segundo grado',
  'Búscame un vuelo a Roma',
  'Cuéntame un chiste',
  'Escribe un poema sobre el mar',
  'Mi coche no arranca esta mañana',
  '¿Cuál es mi horóscopo de hoy?',
  'Instala Docker en mi servidor',
  // English
  'Write a function in Python',
  'How do I invest in the stock market?',
  'Recommend a show on Netflix',
  'Who won the World Cup?',
  'Explain the Dijkstra algorithm',
  'Tell me about the US election',
  "What's the weather tomorrow?",
  'Solve this algebra equation',
  'Book me a flight to Rome',
  'Tell me a joke',
  'Write a poem about the sea',
  'My car broke down this morning',
  "What's my horoscope today?",
  'Install Docker on my laptop',
]

const AMBIGUOUS: string[] = [
  'Hola',
  'Gracias por tu ayuda',
  '¿Tú qué opinas?',
  'ok',
  'Hello there',
]

// ─── 1. Topic gate ───────────────────────────────────────────────────────────

describe('Security harness · topic gate · in-scope queries reach the LLM', () => {
  it.each(IN_SCOPE)('classifies %p as in-scope', (q) => {
    expect(classify(q)).toBe('in')
  })
})

describe('Security harness · topic gate · off-topic queries are hard-refused', () => {
  it.each(OUT_OF_SCOPE)('classifies %p as out-of-scope', (q) => {
    // 'out' is the contract: the engine returns a canned refusal and spends
    // zero inference. Anything else would let the query reach the model.
    expect(classify(q)).toBe('out')
  })

  it.each(OUT_OF_SCOPE)('never mislabels %p as in-scope', (q) => {
    expect(classify(q)).not.toBe('in')
  })
})

describe('Security harness · topic gate · ambiguous queries defer to the LLM guardrail', () => {
  it.each(AMBIGUOUS)('classifies %p as ambiguous (handled by the prompt guardrail)', (q) => {
    expect(classify(q)).toBe('ambiguous')
  })
})

// ─── 2. Age gate ─────────────────────────────────────────────────────────────

function dobForAge(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

const member = (dob: unknown): FamilyMember =>
  ({
    id: 'm', name: 'T', role: 'father', dateOfBirth: dob, weight: 0, height: 0,
    allergies: [], conditions: [], dietPreference: 'none', isSchoolAge: false,
    favoriteRecipeIds: [], documents: [], isSuperUser: false, createdAt: '', updatedAt: '',
  }) as FamilyMember

describe('Security harness · age gate · minors can never reach the assistant', () => {
  it('allows a verified adult (35)', () => {
    expect(isAIAccessibleForMember(member(dobForAge(35)))).toBe(true)
  })
  it('allows the exact 18 boundary', () => {
    expect(isAIAccessibleForMember(member(dobForAge(18)))).toBe(true)
  })
  it('blocks a 17-year-old minor', () => {
    expect(isAIAccessibleForMember(member(dobForAge(17)))).toBe(false)
  })
  it('blocks a newborn', () => {
    expect(isAIAccessibleForMember(member(dobForAge(0)))).toBe(false)
  })
  it('blocks a null member (no active profile)', () => {
    expect(isAIAccessibleForMember(null)).toBe(false)
  })
  it('blocks a missing date of birth', () => {
    expect(isAIAccessibleForMember(member(undefined))).toBe(false)
  })
  it('blocks a malformed date of birth', () => {
    expect(isAIAccessibleForMember(member('not-a-date'))).toBe(false)
  })
  it('blocks a future date of birth', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(isAIAccessibleForMember(member(tomorrow.toISOString().split('T')[0]))).toBe(false)
  })
})

// ─── 3. Refusal UX ───────────────────────────────────────────────────────────

describe('Security harness · refusal copy is localized and on-brand', () => {
  afterEach(() => {
    mockLocale.code = 'es'
  })

  it('Spanish refusal names NutriBot and redirects to scope', () => {
    mockLocale.code = 'es'
    const msg = getRefusalMessage()
    expect(msg).toMatch(/NutriBot/)
    expect(msg.toLowerCase()).toMatch(/nutrición|alimentación/)
    expect(msg.length).toBeGreaterThan(40)
  })

  it('English refusal names NutriBot and redirects to scope', () => {
    mockLocale.code = 'en'
    const msg = getRefusalMessage()
    expect(msg).toMatch(/NutriBot/)
    expect(msg.toLowerCase()).toMatch(/nutrition|food/)
    expect(msg.length).toBeGreaterThan(40)
  })
})
