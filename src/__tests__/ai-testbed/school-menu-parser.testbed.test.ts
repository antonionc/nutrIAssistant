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
  extractTableDayBlocks,
  extractDocumentMonthAnchor,
  validateParsedEntries,
  sanitizeMenuBody,
  stripMacroTailsForDayDetection,
  SCHOOL_MENU_NO_DATA_SENTINEL,
  parseSchoolMenuViaGeometry,
  type PdfLine,
} from '../../services/schoolMenuParser'
import balderLines from './fixtures/balder-may-2026-lines.json'

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

  it('promotes a single-line body to firstCourse rather than dropping it', () => {
    // Column-major PDFs frequently emit each day's cell as a single line of
    // dish text with no course markers. Rather than dropping the entry —
    // which would silently lose the day — promote the sanitized description
    // to firstCourse so the review modal surfaces it for the user to edit.
    const pdf =
      'LUNES 6 DE ABRIL\none vague line of dish text\n' +
      'MARTES 7 DE ABRIL\nPrimer plato: Sopa\nSegundo plato: Pollo\nPostre: Fruta'
    const out = deterministicSchoolMenuParse(pdf, ref)
    expect(out).toHaveLength(2)
    expect(out[0].date).toBe('2026-04-06')
    expect(out[0].firstCourse).toBe('one vague line of dish text')
    expect(out[1].date).toBe('2026-04-07')
    expect(out[1].firstCourse).toBe('Sopa')
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

// ─── 8. extractDocumentMonthAnchor — pulls month/year from PDF header ───────

describe('School-menu parser · extractDocumentMonthAnchor', () => {
  const refDate = new Date('2026-05-20')

  it('reads "MENÚ MAYO 2026 BALDER" from the title row', () => {
    const pdf = 'MENÚ MAYO 2026 BALDER\nBasal — Colegio Balder\nLunes Martes...'
    const a = extractDocumentMonthAnchor(pdf, refDate)
    expect(a).toEqual({ month: 5, year: 2026, inferred: false })
  })

  it('reads English "May 2026" too', () => {
    const pdf = 'School lunch menu — May 2026\nMonday Tuesday Wednesday...'
    const a = extractDocumentMonthAnchor(pdf, refDate)
    expect(a).toEqual({ month: 5, year: 2026, inferred: false })
  })

  it('reads month following year ("2026 MAYO")', () => {
    const pdf = 'Colegio Balder · 2026 MAYO\nLunes Martes...'
    const a = extractDocumentMonthAnchor(pdf, refDate)
    expect(a).toEqual({ month: 5, year: 2026, inferred: false })
  })

  it('falls back to refDate when no anchor is detectable', () => {
    const pdf = 'Just a list of dishes with no header.\nMacarrones\nMerluza'
    const a = extractDocumentMonthAnchor(pdf, refDate)
    expect(a).toEqual({ month: 5, year: 2026, inferred: true })
  })

  it('ignores stray 4-digit numbers that are not a year (e.g. recipe IDs)', () => {
    const pdf = 'Receta 4567\nMacarrones\nMerluza'
    const a = extractDocumentMonthAnchor(pdf, refDate)
    expect(a.inferred).toBe(true)
  })
})

// ─── 9. extractTableDayBlocks — tabular weekly-grid menus ───────────────────

describe('School-menu parser · extractTableDayBlocks', () => {
  const refDate = new Date('2026-05-20')

  it('extracts five day cells from a single-row weekly grid', () => {
    // Simulates PDFKit's row-major extraction of a Lunes…Viernes header
    // followed by one row with day numbers 4..8 and dishes between them.
    const pdf =
      'MENÚ MAYO 2026 BALDER\n' +
      'Lunes Martes Miércoles Jueves Viernes\n' +
      '4 Macarrones a la Carbonara · Merluza al Ajillo · Fruta y Pan\n' +
      '5 Lentejas con Verduras y Chorizo · Tortilla Francesa con York · Fruta y Pan\n' +
      '6 Coliflor con Bechamel · Escalope de Pollo · Fruta y Pan Integral\n' +
      '7 Arroz con Tomate Confitado · Fogonero al Horno · Ensalada de Remolacha\n' +
      '8 Sopa de Cocido · Cocido Completo · Helado de Nata-Fresa'
    const blocks = extractTableDayBlocks(pdf, refDate)
    expect(blocks).toHaveLength(5)
    expect(blocks[0].date).toBe('2026-05-04')
    expect(blocks[0].body).toContain('Macarrones a la Carbonara')
    expect(blocks[1].date).toBe('2026-05-05')
    expect(blocks[1].body).toContain('Lentejas con Verduras y Chorizo')
    // Critical regression check: Tuesday must NOT borrow Wednesday's
    // "Coliflor con Bechamel" (the bug that triggered this fix).
    expect(blocks[1].body).not.toContain('Coliflor')
    expect(blocks[2].date).toBe('2026-05-06')
    expect(blocks[2].body).toContain('Coliflor con Bechamel')
    expect(blocks[4].date).toBe('2026-05-08')
    expect(blocks[4].body).toContain('Sopa de Cocido')
  })

  it('handles a full four-week grid with week boundaries (4–8, 11–15, …)', () => {
    const pdf =
      'MENÚ MAYO 2026 BALDER\nLunes Martes Miércoles Jueves Viernes\n' +
      '4 W1L\n5 W1M\n6 W1X\n7 W1J\n8 W1V\n' +
      '11 W2L\n12 W2M\n13 W2X\n14 W2J\n15 W2V\n' +
      '18 W3L\n19 W3M\n20 W3X\n21 W3J\n22 W3V\n' +
      '25 W4L\n26 W4M\n27 W4X\n28 W4J\n29 W4V'
    const blocks = extractTableDayBlocks(pdf, refDate)
    expect(blocks).toHaveLength(20)
    expect(blocks[0].date).toBe('2026-05-04')
    expect(blocks[4].date).toBe('2026-05-08')
    expect(blocks[5].date).toBe('2026-05-11')
    expect(blocks[19].date).toBe('2026-05-29')
    expect(blocks[10].body).toContain('W3L')
  })

  it('skips inline two-digit numbers that are not day-of-month markers', () => {
    // The "12g" inside a description must not be picked up as day 12.
    const pdf =
      'MENÚ MAYO 2026 BALDER\nLunes Martes Miércoles Jueves Viernes\n' +
      '4 Macarrones (12g de proteína) · Pollo · Fruta\n' +
      '5 Lentejas · Merluza · Yogur\n' +
      '6 Coliflor · Escalope · Fruta'
    const blocks = extractTableDayBlocks(pdf, refDate)
    expect(blocks).toHaveLength(3)
    expect(blocks[0].date).toBe('2026-05-04')
    expect(blocks[1].date).toBe('2026-05-05')
    expect(blocks[2].date).toBe('2026-05-06')
  })

  it('returns [] when no weekday header row is present', () => {
    const pdf =
      'Some free-text menu without a weekday header.\n' +
      '4 Macarrones\n5 Lentejas\n6 Coliflor'
    expect(extractTableDayBlocks(pdf, refDate)).toEqual([])
  })

  it('returns [] when fewer than three day cells line up', () => {
    const pdf =
      'MENÚ MAYO 2026 BALDER\nLunes Martes Miércoles Jueves Viernes\n' +
      '4 Macarrones\n5 Lentejas'
    expect(extractTableDayBlocks(pdf, refDate)).toEqual([])
  })

  it('pins dates to the document anchor month, not to refDate', () => {
    // Document says March, refDate is in May — should produce March dates.
    const pdf =
      'MENÚ MARZO 2026 BALDER\nLunes Martes Miércoles Jueves Viernes\n' +
      '2 Macarrones · Pollo · Fruta\n' +
      '3 Lentejas · Merluza · Yogur\n' +
      '4 Coliflor · Escalope · Fruta'
    const blocks = extractTableDayBlocks(pdf, refDate)
    expect(blocks).toHaveLength(3)
    expect(blocks[0].date).toBe('2026-03-02')
    expect(blocks[2].date).toBe('2026-03-04')
  })
})

// ─── 10. deterministicSchoolMenuParse — table-format integration ────────────

describe('School-menu parser · deterministicSchoolMenuParse · table layout', () => {
  const refDate = new Date('2026-05-20')

  it('parses a tabular Balder-style PDF end-to-end with course splitting', () => {
    const pdf =
      'MENÚ MAYO 2026 BALDER\nLunes Martes Miércoles Jueves Viernes\n' +
      '4\nMacarrones a la Carbonara\nMerluza al Ajillo\nFruta y Pan\n' +
      '5\nLentejas con Verduras y Chorizo\nTortilla Francesa con York\nFruta y Pan\n' +
      '6\nColiflor con Bechamel\nEscalope de Pollo\nFruta y Pan Integral\n' +
      '7\nArroz con Tomate Confitado\nFogonero al Horno\nEnsalada de Remolacha\n' +
      '8\nSopa de Cocido\nCocido Completo\nHelado de Nata-Fresa'
    const out = deterministicSchoolMenuParse(pdf, refDate)
    expect(out).toHaveLength(5)
    expect(out[0]).toMatchObject({
      date: '2026-05-04',
      firstCourse: 'Macarrones a la Carbonara',
      secondCourse: 'Merluza al Ajillo',
    })
    expect(out[1]).toMatchObject({
      date: '2026-05-05',
      firstCourse: 'Lentejas con Verduras y Chorizo',
      secondCourse: 'Tortilla Francesa con York',
    })
    // Sanity: the bug we fixed — Tuesday must not carry Wednesday's dish.
    expect(out[1].firstCourse).not.toMatch(/Coliflor/)
  })

  it('still prefers the linear format when both could match', () => {
    // Linear PDF with weekday+date headers — must NOT be misread as table.
    const pdf =
      'LUNES 4 DE MAYO\nPrimer plato: Macarrones\nSegundo plato: Merluza\nPostre: Fruta\n' +
      'MARTES 5 DE MAYO\nPrimer plato: Lentejas\nSegundo plato: Pollo\nPostre: Yogur\n' +
      'MIÉRCOLES 6 DE MAYO\nPrimer plato: Coliflor\nSegundo plato: Escalope\nPostre: Fruta'
    const out = deterministicSchoolMenuParse(pdf, refDate)
    expect(out).toHaveLength(3)
    expect(out[0].firstCourse).toBe('Macarrones')
  })
})

// ─── 11. validateParsedEntries ──────────────────────────────────────────────

describe('School-menu parser · validateParsedEntries', () => {
  const anchor = { month: 5, year: 2026, inferred: false }

  it('accepts a well-formed list and returns it sorted ascending', () => {
    const result = validateParsedEntries(
      [
        { date: '2026-05-06', meal: 'lunch' as const, description: '', firstCourse: 'a', extractedIngredients: [], extractedAllergens: [] },
        { date: '2026-05-04', meal: 'lunch' as const, description: '', firstCourse: 'b', extractedIngredients: [], extractedAllergens: [] },
        { date: '2026-05-05', meal: 'lunch' as const, description: '', firstCourse: 'c', extractedIngredients: [], extractedAllergens: [] },
      ],
      anchor
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries.map((e) => e.date)).toEqual(['2026-05-04', '2026-05-05', '2026-05-06'])
    }
  })

  it('rejects duplicate dates', () => {
    const result = validateParsedEntries(
      [
        { date: '2026-05-04', meal: 'lunch' as const, description: '', firstCourse: 'a', extractedIngredients: [], extractedAllergens: [] },
        { date: '2026-05-04', meal: 'lunch' as const, description: '', firstCourse: 'b', extractedIngredients: [], extractedAllergens: [] },
      ],
      anchor
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('duplicate_dates')
  })

  it('rejects dates more than one month away from the anchor', () => {
    const result = validateParsedEntries(
      [
        { date: '2026-01-04', meal: 'lunch' as const, description: '', firstCourse: 'a', extractedIngredients: [], extractedAllergens: [] },
        { date: '2026-01-05', meal: 'lunch' as const, description: '', firstCourse: 'b', extractedIngredients: [], extractedAllergens: [] },
      ],
      anchor
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('out_of_month')
  })

  it('accepts dates in adjacent months (week-spanning menus)', () => {
    const result = validateParsedEntries(
      [
        { date: '2026-04-30', meal: 'lunch' as const, description: '', firstCourse: 'a', extractedIngredients: [], extractedAllergens: [] },
        { date: '2026-05-01', meal: 'lunch' as const, description: '', firstCourse: 'b', extractedIngredients: [], extractedAllergens: [] },
      ],
      anchor
    )
    expect(result.ok).toBe(true)
  })

  it('rejects more than 5 entries in a single ISO week', () => {
    const entries = ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09']
      .map((date) => ({
        date,
        meal: 'lunch' as const,
        description: '',
        firstCourse: 'x',
        extractedIngredients: [],
        extractedAllergens: [],
      }))
    const result = validateParsedEntries(entries, anchor)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('too_many_per_week')
  })

  it('rejects empty input', () => {
    const result = validateParsedEntries([], anchor)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('empty')
  })
})

// ─── 12. sanitizeMenuBody — strips macros, units, boilerplate ───────────────

describe('School-menu parser · sanitizeMenuBody · macro & unit filter', () => {
  it('drops a Spanish macro line ("HC: 96,74")', () => {
    expect(sanitizeMenuBody('HC: 96,74')).toBe('')
  })

  it('drops a multi-macro line ("Kcal: 724 Lip: 32")', () => {
    expect(sanitizeMenuBody('Kcal: 724 Lip: 32')).toBe('')
  })

  it('drops English macros ("Energy: 724 kcal", "Protein: 30 g")', () => {
    expect(sanitizeMenuBody('Energy: 724 kcal\nProtein: 30 g')).toBe('')
  })

  it('strips an inline macro tail but keeps the dish name', () => {
    // "Pollo asado con arroz   HC: 35 Kcal: 480" → "Pollo asado con arroz"
    const out = sanitizeMenuBody('Pollo asado con arroz   HC: 35 Kcal: 480')
    expect(out).toBe('Pollo asado con arroz')
  })

  it('drops a unit-only line ("32 g", "724", "30 %")', () => {
    expect(sanitizeMenuBody('32 g\n724\n30 %')).toBe('')
  })

  it('drops document boilerplate (Página, IVA, Total semanal)', () => {
    const body = 'Página 1 de 2\nIVA incluido\nTotal semanal\nMacarrones con tomate'
    expect(sanitizeMenuBody(body)).toBe('Macarrones con tomate')
  })

  it('keeps a normal dish line untouched', () => {
    const body = 'Macarrones con tomate\nMerluza al horno\nFruta y pan'
    expect(sanitizeMenuBody(body)).toBe('Macarrones con tomate\nMerluza al horno\nFruta y pan')
  })

  it('is idempotent — sanitizing twice yields the same result', () => {
    const dirty = 'HC: 96,74\nMacarrones con tomate\nKcal: 580'
    const once = sanitizeMenuBody(dirty)
    const twice = sanitizeMenuBody(once)
    expect(twice).toBe(once)
  })

  it('handles empty input', () => {
    expect(sanitizeMenuBody('')).toBe('')
  })

  it('reproduces the "Sunday 3 May" bug from production', () => {
    // The screenshot showed a day block that became { firstCourse: "HC: 96,74",
    // secondCourse: "Kcal: 724 Lip: 32", dessert: "" } because the nutritional
    // summary leaked into the day's body. The sanitizer must drop those three
    // lines, leaving an empty body so the entry is filtered out downstream.
    const body = 'HC: 96,74\nKcal: 724 Lip: 32\nPostre'
    const out = sanitizeMenuBody(body)
    // "Postre" alone with no dish text is still kept (could be a header), but
    // the macro lines must be gone.
    expect(out).not.toMatch(/HC:/)
    expect(out).not.toMatch(/Kcal/)
    expect(out).not.toMatch(/Lip/)
  })
})

// ─── 13. extractTableDayBlocks · weekend filter ─────────────────────────────

describe('School-menu parser · extractTableDayBlocks · weekend filter', () => {
  it('drops a day-of-month that falls on Saturday/Sunday', () => {
    // 2026-05-03 is Sunday. The table header (Lun-Vie) cannot legitimately
    // produce a Sunday cell; if the day-3 integer was matched it came from a
    // nutritional summary or a stray number adjacent to the day cells.
    const pdf =
      'MENU MAYO 2026 COLEGIO BALDER\n' +
      'LUNES MARTES MIERCOLES JUEVES VIERNES\n' +
      ' 3 Macarrones HC 90\n' +
      ' 4 Lentejas con verduras\n' +
      ' 5 Pollo asado\n' +
      ' 6 Merluza\n' +
      ' 7 Sopa de cocido\n' +
      ' 8 Yogur'
    const out = extractTableDayBlocks(pdf, new Date(2026, 4, 1))
    const dates = out.map((b) => b.date)
    // 2026-05-03 (Sun) must NOT appear; the rest can.
    expect(dates).not.toContain('2026-05-03')
    expect(dates).toContain('2026-05-04')
  })
})

// ─── 14. collapseRepeatedRuns (via cleanCourse) — parallel diet columns ─────

describe('School-menu parser · splitCourses · diet-variant deduplication', () => {
  it('collapses identical phrase runs in a dessert ("Fruta y Pan" × 3)', () => {
    const out = splitCourses({
      description: 'Postre: Fruta y Pan Fruta y Pan Fruta y Pan',
    })
    expect(out.dessert).toBe('Fruta y Pan')
  })

  it('collapses single-word repetitions ("Yogur Yogur Yogur")', () => {
    const out = splitCourses({
      firstCourse: 'Yogur Yogur Yogur',
    })
    expect(out.firstCourse).toBe('Yogur')
  })

  it('collapses only the identical prefix in mixed-variant runs', () => {
    // Production case: "Fruta y Pan" (standard) + "Fruta y Pan Integral" +
    // "Fruta y Pan Helado" — three near-variants concatenated by the
    // parallel-column bleed. The first two "Fruta y Pan" prefixes are
    // strictly identical, so they collapse to one; the distinct suffixes
    // ("Integral", "Helado") survive untouched for the review modal.
    const out = splitCourses({ dessert: 'Fruta y Pan Fruta y Pan Integral Fruta y Pan Helado' })
    expect(out.dessert).toBe('Fruta y Pan Integral Fruta y Pan Helado')
  })

  it('does not touch dishes that legitimately repeat a word', () => {
    const out = splitCourses({ firstCourse: 'Crema de calabaza' })
    expect(out.firstCourse).toBe('Crema de calabaza')
  })
})

// ─── 15. normalizeSchoolMenuEntry · macros never reach the course splitter ──

describe('School-menu parser · normalizeSchoolMenuEntry · sanitizer integration', () => {
  it('strips a macro-laced description before splitting into courses', () => {
    const out = normalizeSchoolMenuEntry({
      date: '2026-05-04',
      description: 'Primer plato: Macarrones HC: 60 Kcal: 480\nSegundo plato: Merluza Prot: 28\nPostre: Fruta y pan',
    })
    expect(out).not.toBeNull()
    expect(out?.firstCourse).toBe('Macarrones')
    expect(out?.secondCourse).toBe('Merluza')
    expect(out?.dessert).toBe('Fruta y pan')
  })

  it('strips macros from EXPLICIT per-course LLM fields', () => {
    const out = normalizeSchoolMenuEntry({
      date: '2026-05-04',
      firstCourse: 'Lentejas con verduras Kcal: 410',
      secondCourse: 'Pollo asado HC: 30 Prot: 35',
      dessert: 'Yogur',
    })
    expect(out?.firstCourse).toBe('Lentejas con verduras')
    expect(out?.secondCourse).toBe('Pollo asado')
    expect(out?.dessert).toBe('Yogur')
  })
})

// ─── 16. stripMacroTailsForDayDetection · pre-parse macro removal ───────────

describe('School-menu parser · stripMacroTailsForDayDetection', () => {
  it('removes a chain of macro pairs but preserves a leading day marker', () => {
    const input = '11 Kcal: 701 Lip: 23,14 Prot: 27,03 HC: 96,74'
    // The day marker survives; the four macro pairs are gone.
    expect(stripMacroTailsForDayDetection(input).trim()).toBe('11')
  })

  it('preserves day markers that follow a macro chain on the same line', () => {
    // Real Balder case: a row of macros is followed by next week's day
    // markers on the same physical line of PDFKit output. A line-tail
    // strip would lose those day markers; the pair-level strip preserves them.
    const input =
      'Kcal: 804 Lip: 27,24 Prot: 40,42 HC: 102,62 25 Lentejas Estofadas al Estilo Tradicional 26 Fogonero en Salsa Verde'
    const out = stripMacroTailsForDayDetection(input).trim()
    expect(out).toMatch(/^25 Lentejas Estofadas/)
    expect(out).toContain('26 Fogonero en Salsa Verde')
    expect(out).not.toMatch(/Kcal|Lip|Prot|HC/)
  })

  it('handles back-to-back macro labels without eating the next label as a unit', () => {
    // "Kcal: 724 Kcal: 805" — the second "Kcal" must NOT be consumed as
    // the unit of "724". Without the `[a-z:=]` exclusion in the unit
    // lookahead, the second label would be eaten leaving ": 805" leftover.
    const input = 'Kcal: 724 Kcal: 805 Kcal: 600 Paella con Pollo'
    expect(stripMacroTailsForDayDetection(input).trim()).toBe('Paella con Pollo')
  })

  it('handles macro tail mixed with dish text in a single line', () => {
    const input = 'Sopa de Cocido Kcal: 655 Lip: 24,12 Prot: 36,16 HC: 75,50'
    expect(stripMacroTailsForDayDetection(input).trim()).toBe('Sopa de Cocido')
  })

  it('is a no-op on text without macros', () => {
    const input = '15 FESTIVO 18'
    expect(stripMacroTailsForDayDetection(input)).toBe(input)
  })

  it('handles empty input', () => {
    expect(stripMacroTailsForDayDetection('')).toBe('')
  })
})

// ─── 17. extractTableDayBlocks · footer cutoff ──────────────────────────────

describe('School-menu parser · extractTableDayBlocks · footer cutoff', () => {
  it('stops scanning at the legal footer so phantom "1" from "ENSALADAS: Lechuga y 1 o 2 ingredientes" is excluded', () => {
    const pdf =
      'MENU MAYO 2026 BALDER\n' +
      'Lunes Martes Miercoles Jueves Viernes\n' +
      ' 4 Macarrones\n 5 Lentejas\n 6 Coliflor\n 7 Merluza\n 8 Sopa\n' +
      'FRUTA VARIADA y de TEMPORADA\n' +
      'ENSALADAS: Lechuga y 1 o 2 ingredientes\n' +
      'REGLAMENTO 1169/2011. Toda la informacion sobre alergenos…'
    const out = extractTableDayBlocks(pdf, new Date(2026, 4, 1))
    const dates = out.map((b) => b.date).sort()
    // Real days 4-8 (all Mon-Fri in May 2026): present.
    expect(dates).toContain('2026-05-04')
    expect(dates).toContain('2026-05-05')
    // Phantom day 1 from the legal footer: absent.
    expect(dates).not.toContain('2026-05-01')
    // Phantom day 2 from the same footer: absent.
    expect(dates).not.toContain('2026-05-02')
  })
})

// ─── 18. extractTableDayBlocks · per-position slicing ───────────────────────

describe('School-menu parser · extractTableDayBlocks · cell isolation', () => {
  it('uses next text-position (not next chronological day) as the body cutoff', () => {
    // Simulates a column-major PDF where Friday's day-of-month appears in
    // the text BEFORE Thursday's (PDFKit reading bottom-up). Without the
    // per-position cut, day 29 (chronologically last) would slurp day 28's
    // body up to EOF.
    const pdf =
      'MENU MAYO 2026\n' +
      'Lunes Martes Miercoles Jueves Viernes\n' +
      ' 25 Lunes A\n 26 Martes B\n 27 Miercoles C\n' +
      ' 29 \n 28 Jueves D'
    const out = extractTableDayBlocks(pdf, new Date(2026, 4, 1))
    const day29 = out.find((b) => b.date === '2026-05-29')
    const day28 = out.find((b) => b.date === '2026-05-28')
    expect(day28?.body).toMatch(/Jueves D/)
    // Day 29's body must NOT include day 28's text.
    expect(day29?.body ?? '').not.toMatch(/Jueves D/)
  })
})

// ─── 19. End-to-end deterministic parse on a real PDFKit-style text ─────────

describe('School-menu parser · deterministicSchoolMenuParse · Balder-like layout', () => {
  // A condensed version of the Balder May 2026 PDF text. Reproduces the
  // bugs that drove this slicing rework: phantom days from comma decimals
  // in macros, days lost when macros and next-week day markers share a line,
  // and single-line cells previously dropped for lacking course markers.
  const balderText = [
    'MENÚ MAYO 2026 BALDER',
    'Basal - . - Colegio Balder',
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    '4 Macarrones a la Carbonara Merluza al Ajillo Fruta y Pan Lentejas con Verduras y Chorizo 5 6 Coliflor con Bechamel Arroz con Tomate Confitado 7 8',
    'Sopa de Cocido',
    'Tortilla Francesa con York Escalope de Pollo Fogonero al Horno con Perejil Fresco Cocido Completo',
    'Ensalada Variada Ensalada Variada Zanahorias Cubito Salteadas Ensalada de Remolacha Repollo con Ajo Rehogado',
    'Fruta y Pan Fruta y Pan Integral Fruta y Pan Helado de Nata-Fresa y Pan Integral',
    '11 Kcal: 701 Lip: 23,14 Prot: 27,03 HC: 96,74',
    'Kcal: 724 Lip: 32,01 Prot: 28,97 HC: 79,95 Kcal: 805 Lip: 45,36 Prot: 38,54 HC: 62,52',
    'Paella con Verduritas de la Huerta y Pollo 12 Alubias Blancas a la Jardinera Garbanzos con Calamares',
    'FRUTA VARIADA y de TEMPORADA',
    'ENSALADAS: Lechuga y 1 o 2 ingredientes',
    'REGLAMENTO 1169/2011.',
  ].join('\n')

  it('yields no phantom days from comma decimals in macro values', () => {
    const out = deterministicSchoolMenuParse(balderText, new Date(2026, 4, 1))
    const dates = out.map((e) => e.date)
    // 23 (from "23,14"), 14 (from "23,14"), 27 (from "27,03"), 3 (from "27,03")
    // and 1/2 (from the legal footer) must all be absent.
    for (const phantom of ['2026-05-23', '2026-05-14', '2026-05-27', '2026-05-03', '2026-05-01', '2026-05-02']) {
      expect(dates).not.toContain(phantom)
    }
  })

  it('surfaces day 11 (single-line "Paella…" cell) as firstCourse', () => {
    const out = deterministicSchoolMenuParse(balderText, new Date(2026, 4, 1))
    const day11 = out.find((e) => e.date === '2026-05-11')
    expect(day11).toBeDefined()
    expect(day11?.firstCourse).toMatch(/Paella/)
  })

  it('surfaces day 12 even though it shares a line with day 11 content', () => {
    const out = deterministicSchoolMenuParse(balderText, new Date(2026, 4, 1))
    const day12 = out.find((e) => e.date === '2026-05-12')
    expect(day12).toBeDefined()
    expect(day12?.firstCourse).toMatch(/Alubias Blancas|Garbanzos/)
  })

  it('day-4 body never contains macro fragments like "Kcal:" or "HC:"', () => {
    const out = deterministicSchoolMenuParse(balderText, new Date(2026, 4, 1))
    const day4 = out.find((e) => e.date === '2026-05-04')
    expect(day4).toBeDefined()
    const flat = `${day4?.firstCourse ?? ''} ${day4?.secondCourse ?? ''} ${day4?.dessert ?? ''}`
    expect(flat).not.toMatch(/Kcal|Lip\b|Prot|HC:/)
  })
})

// ─── 20. Holiday + no-data sentinel ─────────────────────────────────────────

describe('School-menu parser · holiday / no-data sentinel', () => {
  const ref = new Date(2026, 4, 1) // May 2026

  it('tags an explicit "FESTIVO" cell with the no-data sentinel', () => {
    const pdf =
      'MENU MAYO 2026\n' +
      'Lunes Martes Miercoles Jueves Viernes\n' +
      ' 4 Macarrones\n 5 Lentejas\n 6 Pollo\n 7 Merluza\n 8 Sopa\n' +
      ' 15 FESTIVO'
    const out = deterministicSchoolMenuParse(pdf, ref)
    const day15 = out.find((e) => e.date === '2026-05-15')
    expect(day15).toBeDefined()
    expect(day15?.description).toBe(SCHOOL_MENU_NO_DATA_SENTINEL)
    expect(day15?.firstCourse).toBeUndefined()
  })

  it('tags a sandwiched empty-body day with the no-data sentinel', () => {
    // Day 5 sits between day 4 and day 6 on the same line with no body of
    // its own — a real Balder-shaped case. The detected marker should
    // still produce a placeholder entry so the user sees the day in
    // the review modal.
    const pdf =
      'MENU MAYO 2026\n' +
      'Lunes Martes Miercoles Jueves Viernes\n' +
      ' 4 Macarrones 5 6 Pollo 7 8\nSegundo Tercero Cuarto'
    const out = deterministicSchoolMenuParse(pdf, ref)
    const day5 = out.find((e) => e.date === '2026-05-05')
    expect(day5).toBeDefined()
    expect(day5?.description).toBe(SCHOOL_MENU_NO_DATA_SENTINEL)
  })

  it('recognizes several Spanish/English holiday phrasings', () => {
    const cases = [
      { day: 4, body: 'FESTIVO' },
      { day: 5, body: 'No lectivo' },
      { day: 6, body: 'Puente' },
      { day: 7, body: 'Holiday' },
      { day: 8, body: 'No school' },
    ]
    const pdf =
      'MENU MAYO 2026\n' +
      'Lunes Martes Miercoles Jueves Viernes\n' +
      cases.map((c) => ` ${c.day} ${c.body}`).join('\n')
    const out = deterministicSchoolMenuParse(pdf, ref)
    expect(out).toHaveLength(5)
    for (const e of out) {
      expect(e.description).toBe(SCHOOL_MENU_NO_DATA_SENTINEL)
    }
  })

  it('does NOT tag a real dish whose name contains a holiday keyword', () => {
    // Defensive: HOLIDAY_RE is anchored to the WHOLE trimmed body, so a
    // multi-word dish that happens to include "festivo" survives as a
    // normal entry.
    const pdf =
      'MENU MAYO 2026\n' +
      'Lunes Martes Miercoles Jueves Viernes\n' +
      ' 4 Arroz festivo con verduras\n 5 Lentejas\n 6 Pollo\n 7 Merluza\n 8 Sopa'
    const out = deterministicSchoolMenuParse(pdf, ref)
    const day4 = out.find((e) => e.date === '2026-05-04')
    expect(day4?.description).not.toBe(SCHOOL_MENU_NO_DATA_SENTINEL)
    expect(day4?.firstCourse).toMatch(/Arroz festivo/)
  })
})

// ─── 21. Geometric parser · Balder May 2026 real PDF fixture ────────────────

describe('School-menu parser · parseSchoolMenuViaGeometry · Balder May 2026', () => {
  // 107 line selections produced by PDFKit on the real Balder May 2026 PDF.
  // Reproduces the bug we fixed by adding the geometric pipeline: PDFKit's
  // `page.string` reading order scatters the "5" and "7" day markers
  // ACROSS columns on the same line, which the text-based parser maps to
  // No-Data placeholders. The per-line bounds let us reconstruct the table
  // by column geometry and recover days 5 and 7 with their real dishes.
  const ref = new Date(2026, 4, 1)
  const lines = balderLines as unknown as PdfLine[]

  it('detects all 20 weekdays in May 2026', () => {
    const { entries } = parseSchoolMenuViaGeometry(lines, ref)
    const dates = entries.map((e) => e.date).sort()
    const expected = [
      '2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08',
      '2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15',
      '2026-05-18', '2026-05-19', '2026-05-20', '2026-05-21', '2026-05-22',
      '2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29',
    ]
    expect(dates).toEqual(expected)
  })

  it('extracts day 5 (Martes) with its primer plato "Lentejas con Verduras y Chorizo"', () => {
    // THE original user-reported bug: text-based parser tagged day 5 as
    // "No hay datos / Festivo" because the "5" marker sits on a different
    // PDFKit "line" than its dish text. Geometric extraction puts both in
    // the Martes column and recovers the dishes.
    const { entries } = parseSchoolMenuViaGeometry(lines, ref)
    const day5 = entries.find((e) => e.date === '2026-05-05')
    expect(day5).toBeDefined()
    expect(day5?.firstCourse).toMatch(/Lentejas con Verduras y Chorizo/)
    expect(day5?.description).not.toBe(SCHOOL_MENU_NO_DATA_SENTINEL)
  })

  it('extracts day 7 (Jueves) with its primer plato "Arroz con Tomate Confitado"', () => {
    const { entries } = parseSchoolMenuViaGeometry(lines, ref)
    const day7 = entries.find((e) => e.date === '2026-05-07')
    expect(day7).toBeDefined()
    expect(day7?.firstCourse).toMatch(/Arroz con Tomate Confitado/)
    expect(day7?.description).not.toBe(SCHOOL_MENU_NO_DATA_SENTINEL)
  })

  it('preserves explicit "FESTIVO" cell as a no-data placeholder for day 15', () => {
    const { entries } = parseSchoolMenuViaGeometry(lines, ref)
    const day15 = entries.find((e) => e.date === '2026-05-15')
    expect(day15).toBeDefined()
    // FESTIVO comes through as the description; the no-data sentinel applies
    // when the cell has no usable text at all. For "FESTIVO" the parser keeps
    // the literal as firstCourse so the user knows it's a holiday cell.
    expect(day15?.firstCourse ?? '').toMatch(/FESTIVO/i)
  })

  it('returns the correct month/year anchor for May 2026', () => {
    const { anchor } = parseSchoolMenuViaGeometry(lines, ref)
    expect(anchor.month).toBe(5)
    expect(anchor.year).toBe(2026)
  })

  it('returns [] when fewer than 5 weekday header lines are present', () => {
    // Defensive: a PDF that doesn't have the canonical Lun/Mar/Mié/Jue/Vie
    // header strip is not a school-menu table — return empty so the caller
    // falls back to text-based parsing.
    const bogus: PdfLine[] = [
      { page: 0, text: 'Random title', x: 100, y: 700, w: 50, h: 10 },
      { page: 0, text: 'More random text', x: 100, y: 680, w: 80, h: 10 },
    ]
    const { entries } = parseSchoolMenuViaGeometry(bogus, ref)
    expect(entries).toEqual([])
  })
})
