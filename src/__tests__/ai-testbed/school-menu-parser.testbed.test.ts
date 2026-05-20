/**
 * AI TESTBED — School-menu parser
 * ─────────────────────────────────────────────────────────────────────────────
 * The on-device LLM produces the school-menu JSON, but the deterministic
 * pieces — JSON extraction from Qwen 3's noisy output, ISO-date validation,
 * allergen allowlisting, splitting a single concatenated description into
 * primer/segundo/postre — live in `src/services/schoolMenuParser.ts` and
 * are covered here.
 */
import {
  parseSchoolMenuResponse,
  normalizeSchoolMenuEntry,
  splitCourses,
  extractDayBlocks,
  deterministicSchoolMenuParse,
} from '../../services/schoolMenuParser'

// ─── 1. parseSchoolMenuResponse — extraction from the LLM's noisy output ────

describe('School-menu parser · parseSchoolMenuResponse · noise tolerance', () => {
  it('parses a clean JSON array verbatim', () => {
    const out = parseSchoolMenuResponse(
      '[{"date":"2026-05-04","firstCourse":"Lentejas","secondCourse":"Pollo","dessert":"Fruta"}]'
    )
    expect(out).toHaveLength(1)
    expect(out?.[0].date).toBe('2026-05-04')
  })

  it('strips a markdown code fence around the array', () => {
    const raw = '```json\n[{"date":"2026-05-04","firstCourse":"Sopa","secondCourse":"Merluza","dessert":"Pan"}]\n```'
    const out = parseSchoolMenuResponse(raw)
    expect(out).toHaveLength(1)
    expect(out?.[0].secondCourse).toBe('Merluza')
  })

  it('strips a well-formed <think>…</think> block before the array', () => {
    const raw = '<think>Let me reason about the menu…</think>\n[{"date":"2026-05-04","firstCourse":"Lentejas"}]'
    const out = parseSchoolMenuResponse(raw)
    expect(out).toHaveLength(1)
    expect(out?.[0].firstCourse).toBe('Lentejas')
  })

  it('salvages an array that follows a stray </think> with no opening tag', () => {
    // Qwen 3 occasionally emits `</think>` without the matching `<think>` —
    // happens when the model is truncated mid-reasoning and the first
    // tokens we see are from the tail of the think block. The parser
    // strips everything up to the first `</think>` so the JSON tail
    // remains parseable.
    const raw = 'leftover reasoning text </think>\n[{"date":"2026-05-04","firstCourse":"Lentejas"}]'
    const out = parseSchoolMenuResponse(raw)
    expect(out).toHaveLength(1)
    expect(out?.[0].firstCourse).toBe('Lentejas')
  })

  it('drops content after an unclosed <think> (no way to know where reasoning ends)', () => {
    // This is the documented limit of the recovery path. If Qwen never
    // closes the think block, we cannot tell where reasoning stops and
    // the JSON begins, so we strip from `<think>` to end and return null.
    const raw = '<think>thinking but ran out of tokens never closed\n[{"date":"2026-05-04","firstCourse":"Lentejas"}]'
    expect(parseSchoolMenuResponse(raw)).toBeNull()
  })

  it('fixes Qwen 3\'s `}",` element separator bug', () => {
    const raw = '[{"date":"2026-05-04","firstCourse":"a"}","date":"2026-05-05","firstCourse":"b"}]'
    const out = parseSchoolMenuResponse(raw)
    expect(out).toHaveLength(2)
    expect(out?.[0].date).toBe('2026-05-04')
    expect(out?.[1].date).toBe('2026-05-05')
  })

  it('salvages a truncated array by closing after the last complete object', () => {
    const raw = '[{"date":"2026-05-04","firstCourse":"a"},{"date":"2026-05-05","firstCourse":"b"},{"date":"2026-05-06","first'
    const out = parseSchoolMenuResponse(raw)
    expect(out).toHaveLength(2)
    expect(out?.[1].date).toBe('2026-05-05')
  })

  it('unwraps an object-wrapped array (e.g. {"days":[…]})', () => {
    const raw = '{"days":[{"date":"2026-05-04","firstCourse":"a"}]}'
    const out = parseSchoolMenuResponse(raw)
    expect(out).toHaveLength(1)
  })

  it('returns null when there is no JSON in the response at all', () => {
    expect(parseSchoolMenuResponse('Sorry, I cannot help with that.')).toBeNull()
  })

  it('returns null on an empty input', () => {
    expect(parseSchoolMenuResponse('')).toBeNull()
  })
})

// ─── 2. splitCourses — turning one description into three structured fields ─

describe('School-menu parser · splitCourses · Spanish keyword markers', () => {
  it('splits "Primer plato: …. Segundo plato: …. Postre: …"', () => {
    const out = splitCourses({
      description:
        'Primer plato: Lentejas con verduras. Segundo plato: Pollo asado con arroz. Postre: Fruta y pan.',
    })
    expect(out.firstCourse).toBe('Lentejas con verduras')
    expect(out.secondCourse).toBe('Pollo asado con arroz')
    expect(out.dessert).toBe('Fruta y pan')
  })

  it('handles numeric prefixes ("1º plato", "2º plato")', () => {
    const out = splitCourses({
      description: '1º plato: Macarrones. 2º plato: Merluza. Postre: Yogur.',
    })
    expect(out.firstCourse).toBe('Macarrones')
    expect(out.secondCourse).toBe('Merluza')
    expect(out.dessert).toBe('Yogur')
  })

  it('handles "Primero", "Segundo" short forms', () => {
    const out = splitCourses({
      description: 'Primero: Sopa de cocido. Segundo: Pavo al ajillo. Postre: Fruta.',
    })
    expect(out.firstCourse).toBe('Sopa de cocido')
    expect(out.secondCourse).toBe('Pavo al ajillo')
    expect(out.dessert).toBe('Fruta')
  })
})

describe('School-menu parser · splitCourses · English keyword markers', () => {
  it('splits "First course: …. Main course: …. Dessert: …"', () => {
    const out = splitCourses({
      description:
        'First course: Lentil soup. Main course: Roast chicken with rice. Dessert: Fruit.',
    })
    expect(out.firstCourse).toBe('Lentil soup')
    expect(out.secondCourse).toBe('Roast chicken with rice')
    expect(out.dessert).toBe('Fruit')
  })
})

describe('School-menu parser · splitCourses · structural fallback', () => {
  it('splits 3 newline-separated lines as first / second / dessert', () => {
    const out = splitCourses({
      description: 'Lentejas con verduras\nPollo asado con arroz\nFruta del día',
    })
    expect(out.firstCourse).toBe('Lentejas con verduras')
    expect(out.secondCourse).toBe('Pollo asado con arroz')
    expect(out.dessert).toBe('Fruta del día')
  })

  it('detects a dessert-like last segment ("Yogur") and assigns it to dessert', () => {
    const out = splitCourses({
      description: 'Crema de calabaza\nFilete de ternera con patatas\nMerluza al horno\nYogur natural',
    })
    expect(out.firstCourse).toBe('Crema de calabaza')
    expect(out.secondCourse).toContain('ternera')
    expect(out.secondCourse).toContain('Merluza')
    expect(out.dessert).toBe('Yogur natural')
  })

  it('returns only first + second courses when input has 2 segments', () => {
    const out = splitCourses({
      description: 'Sopa de fideos\nPescado con ensalada',
    })
    expect(out.firstCourse).toBe('Sopa de fideos')
    expect(out.secondCourse).toBe('Pescado con ensalada')
    expect(out.dessert).toBeUndefined()
  })

  it('returns all undefined when the input is one unsplittable line', () => {
    const out = splitCourses({ description: 'Algo cualquiera sin estructura' })
    expect(out.firstCourse).toBeUndefined()
    expect(out.secondCourse).toBeUndefined()
    expect(out.dessert).toBeUndefined()
  })

  it('returns all undefined when description is empty', () => {
    expect(splitCourses({ description: '' })).toEqual({})
  })
})

describe('School-menu parser · splitCourses · trusts explicit LLM fields', () => {
  it('keeps explicit firstCourse / secondCourse / dessert verbatim', () => {
    const out = splitCourses({
      description: 'this should be ignored',
      firstCourse: 'Garbanzos con espinacas',
      secondCourse: 'Salmón con verduras',
      dessert: 'Fruta y pan',
    })
    expect(out.firstCourse).toBe('Garbanzos con espinacas')
    expect(out.secondCourse).toBe('Salmón con verduras')
    expect(out.dessert).toBe('Fruta y pan')
  })

  it('falls back to description-splitting when explicit fields are all empty', () => {
    const out = splitCourses({
      description: 'Primer plato: Crema. Segundo plato: Pollo. Postre: Fruta.',
      firstCourse: '',
      secondCourse: '',
      dessert: '',
    })
    expect(out.firstCourse).toBe('Crema')
    expect(out.secondCourse).toBe('Pollo')
    expect(out.dessert).toBe('Fruta')
  })
})

// ─── 3. Concatenated cell with no course markers ─────────────────────────────
// A PDF table whose text extraction collapses three courses, allergens and
// nutrition into one line cannot be split safely — assert that the parser
// returns empty structured courses and the normalizer preserves the
// original description as fallback.

describe('School-menu parser · splitCourses · unsplittable concatenated cell', () => {
  const concatenated =
    'Huevos Villaroy Fogonero Rebozado con Ajito y Perejil Pavo al Ajillo Cocido Madrileño Zanahoria Baby Ensalada Variada Ensalada Variada Repollo con Ajo Rehogado Vaso de Leche y Pan Fruta y Pan Integral Fruta y Pan Fruta y Pan Integral'

  it('returns empty structured courses when the text has no markers and no newlines', () => {
    const out = splitCourses({ description: concatenated })
    expect(out.firstCourse).toBeUndefined()
    expect(out.secondCourse).toBeUndefined()
    expect(out.dessert).toBeUndefined()
  })

  it('normalizeSchoolMenuEntry keeps the description so nothing is silently lost', () => {
    const entry = normalizeSchoolMenuEntry({
      date: '2026-04-07',
      description: concatenated,
      extractedIngredients: [],
      extractedAllergens: [],
    })
    expect(entry).not.toBeNull()
    expect(entry?.description).toBe(concatenated)
  })
})

// ─── 4. normalizeSchoolMenuEntry — validation + field cleanup ───────────────

describe('School-menu parser · normalizeSchoolMenuEntry', () => {
  it('returns null for a missing or malformed date', () => {
    expect(normalizeSchoolMenuEntry({ description: 'X' })).toBeNull()
    expect(normalizeSchoolMenuEntry({ date: 'not-a-date', description: 'X' })).toBeNull()
    expect(normalizeSchoolMenuEntry({ date: '2026/05/04', description: 'X' })).toBeNull()
    expect(normalizeSchoolMenuEntry({ date: '04-05-2026', description: 'X' })).toBeNull()
  })

  it('filters allergens against the EU-14 allowlist and lower-cases them', () => {
    const entry = normalizeSchoolMenuEntry({
      date: '2026-05-04',
      description: 'X',
      extractedAllergens: ['Gluten', 'DAIRY', 'foo', 'fish', 'unknown-allergen', 'EGGS'],
    })
    expect(entry?.extractedAllergens.sort()).toEqual(['dairy', 'eggs', 'fish', 'gluten'])
  })

  it('lower-cases and trims extractedIngredients', () => {
    const entry = normalizeSchoolMenuEntry({
      date: '2026-05-04',
      description: 'X',
      extractedIngredients: ['Lentils', '  Carrot ', 'CHICKEN'],
    })
    expect(entry?.extractedIngredients).toEqual(['lentils', 'carrot', 'chicken'])
  })

  it('preserves nutritionalEstimate when present', () => {
    const entry = normalizeSchoolMenuEntry({
      date: '2026-05-04',
      description: 'X',
      nutritionalEstimate: { calories: 620, protein: 35, carbs: 70, fat: 18 },
    })
    expect(entry?.nutritionalEstimate?.calories).toBe(620)
  })

  it('runs splitCourses end-to-end and persists the structured fields', () => {
    const entry = normalizeSchoolMenuEntry({
      date: '2026-05-04',
      description:
        'Primer plato: Lentejas con verduras. Segundo plato: Pollo asado con arroz. Postre: Fruta y pan.',
    })
    expect(entry?.firstCourse).toBe('Lentejas con verduras')
    expect(entry?.secondCourse).toBe('Pollo asado con arroz')
    expect(entry?.dessert).toBe('Fruta y pan')
  })

  it('sets meal=lunch — school menus are always lunch in this app', () => {
    const entry = normalizeSchoolMenuEntry({ date: '2026-05-04', description: 'X' })
    expect(entry?.meal).toBe('lunch')
  })

  it('defaults missing arrays to empty (not undefined)', () => {
    const entry = normalizeSchoolMenuEntry({ date: '2026-05-04', description: 'X' })
    expect(entry?.extractedIngredients).toEqual([])
    expect(entry?.extractedAllergens).toEqual([])
  })
})

// ─── 5. extractDayBlocks — finds day-of-week headers in raw PDF text ────────

describe('School-menu parser · extractDayBlocks · Spanish headers with dates', () => {
  const ref = new Date('2026-04-01')

  it('splits a week of day-header + body blocks into one entry per day', () => {
    const pdf =
      'LUNES 6 DE ABRIL\n' +
      'Primer plato: Lentejas con verduras\n' +
      'Segundo plato: Pollo asado con arroz\n' +
      'Postre: Fruta\n' +
      'MARTES 7 DE ABRIL\n' +
      'Primer plato: Macarrones con tomate\n' +
      'Segundo plato: Merluza al horno\n' +
      'Postre: Yogur natural\n' +
      'MIÉRCOLES 8 DE ABRIL\n' +
      'Primer plato: Sopa de fideos\n' +
      'Segundo plato: Pavo al ajillo\n' +
      'Postre: Fruta y pan integral'
    const blocks = extractDayBlocks(pdf, ref)
    expect(blocks).toHaveLength(3)
    expect(blocks[0].date).toBe('2026-04-06')
    expect(blocks[1].date).toBe('2026-04-07')
    expect(blocks[2].date).toBe('2026-04-08')
    expect(blocks[0].body).toContain('Lentejas')
    expect(blocks[2].body).toContain('Pavo al ajillo')
  })

  it('infers the date from previous-block + 1 when a header has only the day name', () => {
    const pdf =
      'LUNES 6 DE ABRIL\nLentejas\nPollo\nFruta\n' +
      'MARTES\nMacarrones\nMerluza\nYogur'
    const blocks = extractDayBlocks(pdf, ref)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].date).toBe('2026-04-06')
    expect(blocks[1].date).toBe('2026-04-07')
  })

  it('returns empty when no day-of-week headers exist', () => {
    expect(extractDayBlocks('Random nonsense without any day header', ref)).toEqual([])
  })

  it('honors an explicit year when the header carries one', () => {
    const pdf = 'Lunes 6 de abril de 2027\nLentejas\nPollo\nFruta'
    const blocks = extractDayBlocks(pdf, ref)
    expect(blocks[0]?.date).toBe('2027-04-06')
  })

  it('handles English headers ("Monday, 6 April")', () => {
    const pdf =
      'Monday, 6 April\nLentil soup\nRoast chicken\nFruit\n' +
      'Tuesday, 7 April\nPasta\nHake\nYoghurt'
    const blocks = extractDayBlocks(pdf, ref)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].date).toBe('2026-04-06')
    expect(blocks[1].date).toBe('2026-04-07')
  })

  it('picks NEXT year when the closer-to-today resolution wraps around', () => {
    // Late November reference looking at "6 January" with no year:
    // current-year Jan 6 is ~10 months in the past, next-year Jan 6 is ~6
    // weeks ahead — pick the closer one (next year).
    const lateNov = new Date(2026, 10, 25)
    const pdf = 'Lunes 6 de enero\nLentejas\nPollo\nFruta'
    const blocks = extractDayBlocks(pdf, lateNov)
    expect(blocks[0]?.date).toBe('2027-01-06')
  })

  it('keeps the current year when the past distance is smaller than wrapping', () => {
    // May reference looking at "6 April" with no year: current-year is
    // ~6 weeks past, next-year is ~10.5 months ahead. Pick current year.
    const mayRef = new Date(2026, 4, 20)
    const pdf = 'Lunes 6 de abril\nLentejas\nPollo\nFruta'
    const blocks = extractDayBlocks(pdf, mayRef)
    expect(blocks[0]?.date).toBe('2026-04-06')
  })
})

// ─── 6. deterministicSchoolMenuParse — the LLM-skipping fast path ───────────

describe('School-menu parser · deterministicSchoolMenuParse', () => {
  const ref = new Date('2026-04-01')

  it('parses a full week with course markers without calling the LLM', () => {
    const pdf =
      'LUNES 6 DE ABRIL\n' +
      'Primer plato: Lentejas con verduras\n' +
      'Segundo plato: Pollo asado con arroz\n' +
      'Postre: Fruta\n' +
      'MARTES 7 DE ABRIL\n' +
      'Primer plato: Macarrones con tomate\n' +
      'Segundo plato: Merluza al horno\n' +
      'Postre: Yogur natural\n' +
      'MIÉRCOLES 8 DE ABRIL\n' +
      'Primer plato: Sopa de fideos\n' +
      'Segundo plato: Pavo al ajillo\n' +
      'Postre: Fruta y pan integral'
    const out = deterministicSchoolMenuParse(pdf, ref)
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({
      date: '2026-04-06',
      firstCourse: 'Lentejas con verduras',
      secondCourse: 'Pollo asado con arroz',
      dessert: 'Fruta',
      meal: 'lunch',
    })
  })

  it('uses three-line structural fallback when course markers are absent', () => {
    const pdf =
      'LUNES 6 DE ABRIL\nLentejas con verduras\nPollo asado con arroz\nFruta del día\n' +
      'MARTES 7 DE ABRIL\nMacarrones con tomate\nMerluza al horno\nYogur natural'
    const out = deterministicSchoolMenuParse(pdf, ref)
    expect(out).toHaveLength(2)
    expect(out[0].firstCourse).toBe('Lentejas con verduras')
    expect(out[0].dessert).toBe('Fruta del día')
  })

  it('drops blocks where no course could be identified', () => {
    const pdf =
      'LUNES 6 DE ABRIL\none vague line\n' +
      'MARTES 7 DE ABRIL\nPrimer plato: Sopa\nSegundo plato: Pollo\nPostre: Fruta'
    const out = deterministicSchoolMenuParse(pdf, ref)
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-04-07')
  })

  it('returns [] for free-text PDFs with no day headers', () => {
    expect(deterministicSchoolMenuParse('blob of free text', ref)).toEqual([])
  })
})

// ─── 7. parseSchoolMenuResponse — additional permissive shapes ──────────────

describe('School-menu parser · parseSchoolMenuResponse · permissive shapes', () => {
  it('accepts a single object (not an array)', () => {
    const out = parseSchoolMenuResponse(
      '{"date":"2026-04-06","firstCourse":"Lentejas","secondCourse":"Pollo","dessert":"Fruta"}'
    )
    expect(out).toHaveLength(1)
    expect(out?.[0].date).toBe('2026-04-06')
  })

  it('accepts a date-keyed map ({"YYYY-MM-DD": {...}})', () => {
    const raw =
      '{"2026-04-06":{"firstCourse":"Lentejas"},"2026-04-07":{"firstCourse":"Macarrones"}}'
    const out = parseSchoolMenuResponse(raw)
    expect(out).toHaveLength(2)
    expect(out?.find((e) => e.date === '2026-04-06')?.firstCourse).toBe('Lentejas')
  })

  it('collects multiple loose {…"date":…} blocks separated by prose', () => {
    const raw =
      'Day 1: {"date":"2026-04-06","firstCourse":"Lentejas"} ' +
      'Day 2: {"date":"2026-04-07","firstCourse":"Macarrones"}'
    const out = parseSchoolMenuResponse(raw)
    expect(out).toHaveLength(2)
  })
})
