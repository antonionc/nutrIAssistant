/**
 * School-menu parser — pure functions that turn a raw on-device LLM
 * response into structured, persisted `SchoolMenuEntry` records.
 *
 * Two layers:
 *   1. `parseSchoolMenuResponse(raw)` — permissive JSON extractor that
 *      survives every shape Qwen 3 1.7B has ever returned: clean array,
 *      markdown-fenced array, object-wrapped array, truncated array,
 *      `<think>` tags, stray `}",` separator bugs.
 *   2. `normalizeSchoolMenuEntry(entry)` — takes a single LLM-parsed
 *      entry and normalises it into a row ready for `saveSchoolMenuEntry`,
 *      including splitting a single concatenated `description` into
 *      `firstCourse` / `secondCourse` / `dessert` via Spanish/English
 *      keyword heuristics with newline + bullet fallbacks.
 *
 * Both functions are pure and covered by `src/__tests__/services/
 * schoolMenuParser.testbed.test.ts`. Keep them PURE — no React, no DB,
 * no I/O — so the testbed runs in <1 s with no native modules.
 */

import type { SchoolMenuEntry } from '../types/profiles'

// ─── 1. LLM response extraction ─────────────────────────────────────────────

/** What the LLM is asked to emit per day (loose shape — every field optional). */
export interface SchoolMenuParsedEntry {
  date?: string
  description?: string
  firstCourse?: string
  secondCourse?: string
  dessert?: string
  extractedIngredients?: string[]
  extractedAllergens?: string[]
  nutritionalEstimate?: {
    calories: number
    protein: number
    carbs: number
    fat: number
  }
}

/**
 * Extracts the entries array from a raw LLM response. Handles:
 *  - bare JSON arrays ([...])
 *  - arrays wrapped in markdown code fences (```json ... ```)
 *  - arrays nested inside an object ({"days":[...]} / {"menu":[...]})
 *  - truncated tails: re-balance brackets and drop the last incomplete
 *    element so the rest is still salvageable
 *  - `<think>…</think>` reasoning blocks (well-formed or dangling)
 *  - Qwen 3's `}",` element separator bug
 *
 * Returns `null` when nothing usable can be parsed.
 */
export function parseSchoolMenuResponse(raw: string): SchoolMenuParsedEntry[] | null {
  // 1a. Strip well-formed <think>…</think> blocks.
  // 1b. Strip a dangling <think>… with no closing tag (Qwen 3 sometimes
  //     runs out of tokens mid-reasoning). Without /no_think this consumes
  //     the whole response — we still try to recover anything past a
  //     stray </think> if one exists.
  let s = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .replace(/^[\s\S]*?<\/think>/, '')
    .trim()

  // Qwen 3 1.7B occasionally forgets the `},{` array-element separator and
  // emits `}","date":...` (stray quote + comma instead of `},{`). Anchor
  // on what looks like a JSON object opening a new entry so we don't
  // touch this sequence when it appears inside a string value.
  s = s.replace(/\}",\s*(?="[\w-]+"\s*:)/g, '},{')

  // 2. Strip markdown code fences if present.
  s = s.replace(/```(?:json|JSON)?\s*([\s\S]*?)```/g, '$1').trim()

  // 3. Greedy match for the outermost [...] block.
  const arrayMatch = s.match(/\[[\s\S]*\]/)
  const candidates: string[] = []
  if (arrayMatch) candidates.push(arrayMatch[0])

  // 4. If we never found a closing "]", salvage a truncated array by
  //    cutting after the last complete object and appending "]".
  const firstBracket = s.indexOf('[')
  if (firstBracket !== -1 && s.indexOf(']', firstBracket) === -1) {
    const tail = s.slice(firstBracket)
    const lastObjectEnd = tail.lastIndexOf('}')
    if (lastObjectEnd !== -1) {
      candidates.push(tail.slice(0, lastObjectEnd + 1) + ']')
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (Array.isArray(parsed)) return parsed as SchoolMenuParsedEntry[]
    } catch {
      // try next candidate
    }
  }

  // 5. The LLM wrapped the array in an object — either {"days":[...]} or
  //    {"YYYY-MM-DD":{...}, "YYYY-MM-DD":{...}}.
  const objectMatch = s.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try {
      const parsedObj = JSON.parse(objectMatch[0])
      if (parsedObj && typeof parsedObj === 'object') {
        // 5a. Array-valued property.
        for (const value of Object.values(parsedObj)) {
          if (Array.isArray(value)) return value as SchoolMenuParsedEntry[]
        }
        // 5b. Single object that LOOKS like one day entry on its own.
        if ('date' in parsedObj || 'firstCourse' in parsedObj || 'description' in parsedObj) {
          return [parsedObj as SchoolMenuParsedEntry]
        }
        // 5c. Map of {date → entry}.
        const fromMap = Object.entries(parsedObj)
          .filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v === 'object')
          .map(([k, v]) => ({ date: k, ...(v as object) } as SchoolMenuParsedEntry))
        if (fromMap.length > 0) return fromMap
      }
    } catch {
      // try the per-object fallback below
    }
  }

  // 6. Last resort: collect every individual {...} block and hope for the best.
  //    Small models sometimes emit "Día 1: {...}\nDía 2: {...}" with prose
  //    between objects. We extract each balanced object and array them.
  const collected: SchoolMenuParsedEntry[] = []
  const objectRe = /\{[^{}]*"date"[^{}]*\}/g
  let match: RegExpExecArray | null
  while ((match = objectRe.exec(s)) !== null) {
    try {
      const obj = JSON.parse(match[0])
      if (obj && typeof obj === 'object' && 'date' in obj) {
        collected.push(obj as SchoolMenuParsedEntry)
      }
    } catch {
      // skip
    }
  }
  if (collected.length > 0) return collected

  return null
}

// ─── Body sanitizer (drops macros, totals, boilerplate before splitting) ───

// Lines/segments that are macronutrient labels, unit-only values, or document
// boilerplate. School-menu PDFs almost always include a nutritional summary
// (kcal, HC, lípidos, proteínas…) or a price/disclaimer footer adjacent to
// the day cells. PDF text extraction concatenates that noise into the day's
// body, which then leaks into firstCourse/secondCourse/dessert. We strip it
// here BEFORE splitCourses runs.

// Macro keywords — anchored on a label-colon pattern so a stray "Kcal" inside
// a dish name (extremely rare) doesn't fire. Covers the abbreviations Spanish
// menus actually use (HC, Kcal, Lip, Prot, Grasas, Fibra, Sodio, AGS for
// saturated fats), plus English equivalents.
const MACRO_LABEL_RE =
  /\b(?:k?cal|kj|hc|hidratos?(?:\s+de\s+carbono)?|carbs?|lip(?:idos?)?|fats?|prot(?:eins?|e[ií]nas?)?|grasas?(?:\s+sat(?:uradas?)?)?|saturated|ags|az[úu]car(?:es)?|sugars?|fibra|fiber|fibre|sodio|sodium|sal|colesterol|cholesterol|val(?:or)?\s+energ[eé]tico|energ[ií]a|energy|raci[oó]n)\b\s*[:=]/i

// Pure numeric segment, optionally with a unit suffix. Catches "724", "32 g",
// "96,74", "1.234 kcal", "30%".
const NUMERIC_ONLY_RE = /^\s*[\d.,]+\s*(?:k?cal|kj|mg|g|kg|ml|cl|l|%)?\s*$/i

// Document-level boilerplate. These lines slip in when the table is adjacent
// to a header strip, price box, or page footer.
const BOILERPLATE_RE =
  /\b(?:men[uú]\s+(?:escolar|del\s+mes)|comedor|elaborad[oa]\s+por|iva\s+incluid[oa]|precio|p[áa]gina\s+\d|page\s+\d|total\s+semanal|resumen\s+(?:nutricional|semanal)|weekly\s+(?:summary|total)|nutritional\s+summary|alimentos\s+(?:permitidos|recomendados))\b/i

function isNoiseSegment(seg: string): boolean {
  const t = seg.trim()
  if (t.length === 0) return true
  // Single-char or 2-char tokens are noise (stray "g", "kg", "kJ" leftovers).
  if (t.length < 3) return true
  // Pure numeric / numeric-with-unit.
  if (NUMERIC_ONLY_RE.test(t)) return true
  // Macro label leading a value.
  if (MACRO_LABEL_RE.test(t)) return true
  // Page numbers / weekly totals / price disclaimers.
  if (BOILERPLATE_RE.test(t)) return true
  // No alphabetic content at all → noise.
  if (!/[a-záéíóúñ]/i.test(t)) return true
  return false
}

/**
 * Removes macronutrient lines, unit-only tokens, and document boilerplate from
 * a raw day-body before it is fed into `splitCourses`. Idempotent. Returns the
 * surviving lines re-joined with newlines so the downstream splitter can rely
 * on line boundaries.
 *
 * Two cases handled:
 *   1. WHOLE-LINE noise — "HC: 96,74", "Kcal: 724 Lip: 32", "32 g", "Página 1
 *      de 2", "TOTAL SEMANAL". These lines are dropped entirely.
 *   2. INLINE noise — a dish line that ends with a macro tail, e.g. "Pollo
 *      asado con arroz   HC: 35 Kcal: 480". The macro tail (from the first
 *      macro label onwards) is stripped; the dish name survives.
 */
export function sanitizeMenuBody(body: string): string {
  if (!body) return ''
  const lines = body.split(/\r?\n+/)
  const cleaned: string[] = []
  for (const raw of lines) {
    // Strip from the first macro label onward (handles inline tails).
    const stripped = raw
      .replace(
        /\s+(?=\b(?:k?cal|kj|hc|hidratos?|carbs?|lip(?:idos?)?|fats?|prot(?:eins?|e[ií]nas?)?|grasas?|saturated|ags|az[úu]car(?:es)?|sugars?|fibra|fiber|fibre|sodio|sodium|sal|colesterol|cholesterol|val(?:or)?\s+energ[eé]tico|energ[ií]a|energy|raci[oó]n)\b\s*[:=])[\s\S]*$/i,
        ''
      )
      .trim()
    if (isNoiseSegment(stripped)) continue
    cleaned.push(stripped)
  }
  return cleaned.join('\n').trim()
}

/**
 * Sentinel description value emitted by `blocksToEntries` for days where the
 * parser found a day marker but no usable dish text — either an explicit
 * holiday cell ("FESTIVO", "NO LECTIVO", "PUENTE", "HOLIDAY") or a cell
 * that was sandwiched between adjacent day markers on the same line and
 * therefore has an empty body after slicing. The orchestrator (PlannerContext
 * `parseSchoolMenuForReview`) translates this sentinel into a localized
 * "No hay datos / Festivo" label before surfacing entries to the review
 * modal — keeping the parser pure of i18n concerns.
 */
export const SCHOOL_MENU_NO_DATA_SENTINEL = '__SCHOOL_MENU_NO_DATA__'

// Holiday markers that real Spanish/English school PDFs publish in a day's
// cell when there's no lunch service. The regex matches the WHOLE trimmed
// body (anchored), so dish names that happen to contain these words
// ("Pollo con festivo" — not a real dish, but defensively) are unaffected.
const HOLIDAY_RE =
  /^\s*(?:festivo|no\s+lectivo|no\s+hay\s+colegio|sin\s+colegio|sin\s+comedor|puente|cerrado|vacaciones|holiday|holidays|vacation|no\s+school|closed)\s*[.!]?\s*$/i

function looksLikeHoliday(body: string): boolean {
  if (!body) return false
  return HOLIDAY_RE.test(body.trim())
}

/**
 * Strips macronutrient key-value pairs from a raw PDF text so the day-marker
 * detector in `extractTableDayBlocks` doesn't pick up phantom day-of-month
 * integers from inside decimal-comma macro values.
 *
 * Without this preprocessing, a macro line like:
 *
 *   "Kcal: 701 Lip: 23,14 Prot: 27,03 HC: 96,74"
 *
 * emits four false "day-of-month" matches (23, 14, 27, 3) because the regex
 * `\d{1,2}` with non-word lookarounds treats each side of every comma as a
 * standalone token. Those phantoms dedupe ahead of the real markers, so
 * real cells are either lost or get bodies that are macro fragments.
 *
 * Crucially, this strip operates per macro-pair, NOT per line. PDFKit often
 * interleaves macros with the next week's day markers on the SAME line, e.g.
 *
 *   "Kcal: 804 Lip: 27,24 Prot: 40,42 HC: 102,62 25 Lentejas… 26 Fogonero…"
 *
 * A line-tail strip would lose days 25 and 26 along with the macros. The
 * pair-level strip removes only the "Kcal: 804", "Lip: 27,24", etc. tokens
 * and leaves the day markers and dish text intact.
 *
 * Unlike `sanitizeMenuBody`, this preserves short standalone tokens (the
 * day-of-month markers "4", "11", "27") so the subsequent slicing still
 * has anchors.
 */
const MACRO_PAIR_RE =
  /\b(?:k?cal|kj|hc|hidratos?(?:\s+de\s+carbono)?|carbs?|lip(?:idos?)?|fats?|prot(?:eins?|e[ií]nas?)?|grasas?(?:\s+sat(?:uradas?)?)?|saturated|ags|az[úu]car(?:es)?|sugars?|fibra|fiber|fibre|sodio|sodium|sal|colesterol|cholesterol|val(?:or)?\s+energ[eé]tico|energ[ií]a|energy|raci[oó]n)\b\s*[:=]\s*\d+(?:[.,]\d+)?(?:\s*(?:k?cal|kj|mg|g|kg|ml|cl|l|%)(?![a-zñáéíóú:=]))?/gi

export function stripMacroTailsForDayDetection(text: string): string {
  if (!text) return ''
  return text
    .replace(MACRO_PAIR_RE, '')
    // Collapse runs of horizontal whitespace introduced by the strip.
    .replace(/[ \t]{2,}/g, ' ')
    // Collapse "  \n  \n  " into single newlines (so empty-after-strip lines
    // don't survive as whitespace noise).
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
}

// ─── Deterministic preprocessor (skips the LLM when possible) ───────────────

const MONTHS_ES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
}
const MONTHS_EN: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}
const DAYS_ES = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
const DAYS_EN = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Finds day-of-week headers in raw PDF text and returns one block per day,
 * with the day's ISO date resolved (best-effort from the header itself or
 * inferred from the previous header + 1 calendar day).
 *
 * Supports:
 *   - "LUNES 6 DE ABRIL"        → 6 April, year inferred from refDate
 *   - "Lunes 6 abril 2026"      → explicit year
 *   - "Lunes" (no date)         → inferred from refDate or previous block
 *   - "Monday, 6 Apr"           → English equivalent
 */
export function extractDayBlocks(
  pdfText: string,
  refDate: Date = new Date()
): { date: string; body: string }[] {
  if (!pdfText.trim()) return []

  const refYear = refDate.getFullYear()
  const dayWords = [...DAYS_ES, ...DAYS_EN].join('|')
  const monthWords = [...Object.keys(MONTHS_ES), ...Object.keys(MONTHS_EN)].join('|')
  const headerRe = new RegExp(
    String.raw`(?:^|\n|\.\s)\s*(?:(?:${dayWords})(?:\s*,?\s*(?:(\d{1,2})\s*(?:de\s+)?(${monthWords})(?:\s*(?:de\s+)?(\d{4}))?)?))`,
    'gi'
  )

  const normalized = stripDiacritics(pdfText.toLowerCase())
  type Hit = { start: number; end: number; day: number | null; month: number | null; year: number | null }
  const hits: Hit[] = []
  let m: RegExpExecArray | null
  while ((m = headerRe.exec(normalized)) !== null) {
    const day = m[1] ? parseInt(m[1], 10) : null
    const monthName = m[2] ?? null
    const yearTok = m[3] ?? null
    const month = monthName ? (MONTHS_ES[monthName] ?? MONTHS_EN[monthName] ?? null) : null
    const year = yearTok ? parseInt(yearTok, 10) : null
    hits.push({ start: m.index, end: headerRe.lastIndex, day, month, year })
  }
  if (hits.length === 0) return []

  // Bodies: from each hit's end up to the next hit's start (or EOF).
  const blocks: { date: string; body: string }[] = []
  let lastDate: Date | null = null
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]
    const next = hits[i + 1]
    const body = pdfText.slice(h.end, next ? next.start : pdfText.length).trim()
    if (!body) continue

    let resolved: Date | null = null
    if (h.day !== null && h.month !== null) {
      const explicitYear = h.year ?? null
      resolved = explicitYear !== null
        ? new Date(explicitYear, h.month - 1, h.day)
        : pickClosestYear(h.month - 1, h.day, refDate)
    } else if (lastDate) {
      resolved = new Date(lastDate)
      resolved.setDate(resolved.getDate() + 1)
    } else {
      // No date hint at all on the first block — skip rather than guess.
      continue
    }
    lastDate = resolved
    blocks.push({ date: localIsoDate(resolved), body })
  }
  return blocks
}

// When a header carries day+month but no year, pick the year (current or
// current+1) that lands the date closest to today. A school menu published
// in November for "6 January" should resolve to NEXT year, not 9 months
// in the past; one received in May for "6 April" stays in the past.
function pickClosestYear(monthIdx: number, day: number, refDate: Date): Date {
  const refYear = refDate.getFullYear()
  const candidates = [new Date(refYear, monthIdx, day), new Date(refYear + 1, monthIdx, day)]
  let best = candidates[0]
  let bestDist = Math.abs(candidates[0].getTime() - refDate.getTime())
  for (const cand of candidates.slice(1)) {
    const dist = Math.abs(cand.getTime() - refDate.getTime())
    if (dist < bestDist) {
      bestDist = dist
      best = cand
    }
  }
  return best
}

// Format a Date as YYYY-MM-DD using local components — Date.toISOString()
// drifts to UTC, which off-by-ones any timezone east of UTC.
function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Document-level month/year anchor.
 *
 * Spanish school menus print "MENÚ MAYO 2026 BALDER" (or English "MAY 2026
 * MENU") prominently in the first lines. When we can read that anchor we
 * pin every parsed date to that month, which protects the LLM and the
 * table-format parser from year/month drift.
 */
export interface MenuMonthAnchor {
  month: number  // 1-12
  year: number
  inferred: boolean  // true when fallen back to refDate
}

export function extractDocumentMonthAnchor(
  pdfText: string,
  refDate: Date = new Date()
): MenuMonthAnchor {
  const head = stripDiacritics(pdfText.slice(0, 600).toLowerCase())
  const monthWords = [...Object.keys(MONTHS_ES), ...Object.keys(MONTHS_EN)].join('|')
  // Year either follows the month (MAYO 2026) or precedes it (2026 MAYO).
  const reTrailing = new RegExp(String.raw`(${monthWords})\s*(?:de\s+)?(\d{4})`, 'i')
  const reLeading = new RegExp(String.raw`(\d{4})\s+(${monthWords})`, 'i')
  let m = head.match(reTrailing) as RegExpMatchArray | null
  if (m) {
    const month = MONTHS_ES[m[1]] ?? MONTHS_EN[m[1]] ?? null
    const year = parseInt(m[2], 10)
    if (month && Number.isFinite(year)) return { month, year, inferred: false }
  }
  m = head.match(reLeading) as RegExpMatchArray | null
  if (m) {
    const year = parseInt(m[1], 10)
    const month = MONTHS_ES[m[2]] ?? MONTHS_EN[m[2]] ?? null
    if (month && Number.isFinite(year)) return { month, year, inferred: false }
  }
  return { month: refDate.getMonth() + 1, year: refDate.getFullYear(), inferred: true }
}

/**
 * Table-layout extractor.
 *
 * Spanish school menus are commonly published as a 5-column × 4-row grid:
 *
 *     LUNES        MARTES       MIÉRCOLES   JUEVES       VIERNES
 *      4 ...        5 ...        6 ...       7 ...        8 ...
 *     11 ...       12 ...       13 ...      14 ...       15 ...
 *     ...
 *
 * PDF text extraction returns these in either column-major ("4 ... 11 ...
 * 18 ... 25 ... 5 ... 12 ...") or row-major order, but each day cell is
 * anchored by a standalone day-of-month integer. We use those integers
 * as cell delimiters and reconstruct `{date, body}` pairs:
 *
 *  1. Detect a "weekday header strip" — `lunes`, `martes`, `miercoles`,
 *     `jueves`, `viernes` (any 3+ of them) appearing within a short window.
 *     Absent that, this isn't a table; bail and let `extractDayBlocks`
 *     or the LLM handle it.
 *
 *  2. Find every standalone integer `1..31` and keep only those whose
 *     value forms a coherent calendar sequence: each one is strictly
 *     greater than the previous within the anchor month (small dips at
 *     week boundaries like 8→11 are OK because of the column-major case,
 *     handled by ordering hits by VALUE not by position).
 *
 *  3. Slice body text between consecutive hits in the SAME column. Because
 *     PDFKit may interleave columns, we group hits by their integer value
 *     and emit one entry per day-of-month, using the slice from that
 *     hit's `end` to the next hit's `start` regardless of column.
 */
export function extractTableDayBlocks(
  pdfText: string,
  refDate: Date = new Date(),
  anchor?: MenuMonthAnchor
): { date: string; body: string }[] {
  if (!pdfText.trim()) return []
  const a = anchor ?? extractDocumentMonthAnchor(pdfText, refDate)
  // Strip macronutrient tails BEFORE day-marker detection. Decimal commas
  // inside macro values ("27,03", "23,14") would otherwise emit phantom
  // day-of-month tokens that dedupe ahead of the real markers further down
  // the page. Anchor extraction already happened on the raw text above, so
  // the title-month never reaches this strip.
  pdfText = stripMacroTailsForDayDetection(pdfText)
  const normalized = stripDiacritics(pdfText.toLowerCase())

  // 1. Require at least three of {lunes, martes, miercoles, jueves, viernes}
  //    to appear within a 600-char window — that's the header strip.
  const weekdayNames = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes']
  const weekdayPositions: number[] = []
  for (const w of weekdayNames) {
    const i = normalized.indexOf(w)
    if (i !== -1) weekdayPositions.push(i)
  }
  if (weekdayPositions.length < 3) return []
  weekdayPositions.sort((x, y) => x - y)
  const headerSpan = weekdayPositions[weekdayPositions.length - 1] - weekdayPositions[0]
  if (headerSpan > 600) return []

  // 2. Collect day-of-month integers (1..31) appearing as standalone tokens.
  //    A "standalone" token has a non-word character (or start of string)
  //    immediately before AND a non-word character (or end of string)
  //    immediately after. This rejects:
  //      - "2026" (year) — the digits are adjacent to other digits.
  //      - "W1L" / "kcal:12" — the digit has a letter touching it.
  //      - "12g" — same: letter immediately after.
  //    But accepts " 4 Macarrones", "\n4\n", "(4)" — all real day-cell shapes.
  const daysInMonth = new Date(a.year, a.month, 0).getDate()
  const tokenRe = /(?<![\w])(\d{1,2})(?![\w])/g
  type Hit = { value: number; start: number; end: number }
  const allHits: Hit[] = []
  let m: RegExpExecArray | null
  // Scan from AFTER the header strip so the header (Lunes Martes…) doesn't
  // sit between a hit and its body. Use the LAST weekday position as the cut.
  const headerEnd = weekdayPositions[weekdayPositions.length - 1] + 8
  // Stop scanning at the legal/recipe footer that follows the grid. Phrases
  // like "ENSALADAS: Lechuga y 1 o 2 ingredientes…" and the "REGLAMENTO
  // 1169/2011" disclaimer emit standalone digits (1, 2) that would dedupe
  // ahead of any real day 1/2 in the grid.
  const footerRe =
    /\b(?:fruta\s+variada|ensaladas\s*:|reglamento|al[eé]rgenos|elaborado\s+por|toda\s+la\s+informaci[oó]n|alimentos\s+(?:permitidos|recomendados))\b/i
  const footerMatch = normalized.match(footerRe)
  const scanEnd = footerMatch && footerMatch.index !== undefined && footerMatch.index > headerEnd
    ? footerMatch.index
    : normalized.length
  while ((m = tokenRe.exec(normalized)) !== null) {
    if (m.index < headerEnd) continue
    if (m.index >= scanEnd) break
    const value = parseInt(m[1], 10)
    if (value < 1 || value > daysInMonth) continue
    allHits.push({ value, start: m.index, end: tokenRe.lastIndex })
  }
  if (allHits.length < 3) return []

  // 3. Dedupe by value (keep the FIRST occurrence of each day-of-month —
  //    re-mentions like "el 4 de mayo" inside a dish description are noise).
  const byValue = new Map<number, Hit>()
  for (const hit of allHits) {
    if (!byValue.has(hit.value)) byValue.set(hit.value, hit)
  }
  // Reject if we found fewer than 3 distinct days — not enough for a menu.
  if (byValue.size < 3) return []

  // 4. Order hits chronologically (by day value, NOT by text position). For
  //    each day, slice the body from its hit's `end` to the next hit's
  //    `start`. The "next hit" is the next chronological day's first
  //    occurrence in the raw text. This works for both column-major
  //    (positions descend across days within a week) and row-major
  //    (positions ascend) text orderings — we always take whatever text
  //    sits BETWEEN this day's marker and the next day's marker. For
  //    column-major specifically we slice from this hit's `end` to the
  //    next chronological hit's `start`, and pick whichever produces the
  //    shorter non-empty body to avoid sucking in another column's text.
  const sortedHits = Array.from(byValue.entries())
    .sort(([a1], [b1]) => a1 - b1)
    .map(([, h]) => h)

  const blocks: { date: string; body: string }[] = []
  for (let i = 0; i < sortedHits.length; i++) {
    const cur = sortedHits[i]
    // Body = text from this marker to the NEXT TEXT-POSITION marker (not
    // the next chronological marker). This is critical for column-major
    // PDFs where days within a week can be emitted out of chronological
    // order — e.g. PDFKit reading week 5 column-bottom-up emits "29 …
    // 28" so day-29's body would otherwise extend to EOF (sweeping up
    // day-28's cell) since 29 is the last chronological day. Always
    // cutting at the next text-position marker keeps each day inside
    // its own cell regardless of reading-order quirks.
    const fwdEnd =
      [...allHits]
        .filter((h) => h.start > cur.end)
        .map((h) => h.start)
        .sort((x, y) => x - y)[0] ?? pdfText.length
    // KEEP empty bodies: a sandwiched day marker (e.g. "4 dishes… 5 6 more")
    // still emits a valid date that the user should see in the review modal
    // as a "No hay datos / Festivo" placeholder. blocksToEntries detects the
    // empty body downstream and tags it with SCHOOL_MENU_NO_DATA_SENTINEL.
    const body = pdfText.slice(cur.end, fwdEnd).trim()
    const d = new Date(a.year, a.month - 1, cur.value)
    // Drop Sat/Sun: the table header is Mon-Fri only, so a weekend day-of-
    // month landing here came from a stray integer (a price, a row-count,
    // a nutritional summary). The PDF cannot legitimately publish a
    // school-lunch row on a weekend column we never matched in the header.
    const weekday = d.getDay()
    if (weekday === 0 || weekday === 6) continue
    blocks.push({ date: localIsoDate(d), body })
  }

  // 5. Final sanity check: at least 3 distinct days must remain after we
  //    drop empty bodies, otherwise this wasn't a table after all.
  if (blocks.length < 3) return []
  return blocks
}

/**
 * Deterministic parse of a raw PDF text. Returns normalized entries when
 * the text follows the canonical Spanish/English school-menu format
 * (day-of-week headers + course markers or three lines per day). Returns
 * an empty array when the format is too irregular — the caller then falls
 * back to the LLM.
 *
 * Tries two layouts in order:
 *   (1) Linear "LUNES 6 DE ABRIL / Primer plato: …" headers (existing path).
 *   (2) Tabular weekly grid with bare day-of-month markers under a
 *       Lunes/Martes/Miércoles header row.
 *
 * For PDFs where the reading order flattens cells across columns (PDFKit
 * frequently does this for table grids), prefer `parseSchoolMenuViaGeometry`
 * — which takes structured line bounds from the native extractor and rebuilds
 * the table by column geometry rather than by string position.
 */
export function deterministicSchoolMenuParse(
  pdfText: string,
  refDate: Date = new Date()
): Array<Omit<SchoolMenuEntry, 'id' | 'childId'>> {
  // Layer 1 — linear day-of-week headers.
  const linearBlocks = extractDayBlocks(pdfText, refDate)
  const linearOut = blocksToEntries(linearBlocks)
  if (linearOut.length >= 3) return linearOut

  // Layer 2 — tabular grid. Pull the anchor from the document so dates pin
  // to the published month, not today's month.
  const anchor = extractDocumentMonthAnchor(pdfText, refDate)
  const tableBlocks = extractTableDayBlocks(pdfText, refDate, anchor)
  const tableOut = blocksToEntries(tableBlocks)
  if (tableOut.length >= 3) return tableOut

  // Fallback: whichever layer found ≥1 structured entry. Better to ship a
  // partial deterministic parse than to invoke the LLM on garbage.
  return linearOut.length >= tableOut.length ? linearOut : tableOut
}

function blocksToEntries(
  blocks: { date: string; body: string }[]
): Array<Omit<SchoolMenuEntry, 'id' | 'childId'>> {
  const out: Array<Omit<SchoolMenuEntry, 'id' | 'childId'>> = []
  for (const block of blocks) {
    const sanitized = sanitizeMenuBody(block.body || '')

    // Holiday / no-data case: either the cell is empty (sandwiched between
    // day markers on the same line) or it carries an explicit "FESTIVO" /
    // "NO LECTIVO" / "PUENTE" marker. Emit a placeholder entry the
    // orchestrator translates into a localized "No hay datos / Festivo"
    // label before surfacing to the review modal — the user can confirm,
    // edit, or remove the day.
    if (!sanitized || looksLikeHoliday(sanitized)) {
      out.push({
        date: block.date,
        meal: 'lunch',
        description: SCHOOL_MENU_NO_DATA_SENTINEL,
        extractedIngredients: [],
        extractedAllergens: [],
      })
      continue
    }

    const normalized = normalizeSchoolMenuEntry({ date: block.date, description: block.body })
    if (!normalized) continue
    if (!normalized.firstCourse && !normalized.secondCourse && !normalized.dessert) {
      // No structured course but the sanitized description has real text.
      // Promote it to firstCourse so the entry surfaces — common with
      // column-major PDFs where each day's cell is a single line and
      // splitCourses can't infer course boundaries from one segment.
      const desc = normalized.description?.trim() ?? ''
      if (desc.length >= 3) {
        out.push({ ...normalized, firstCourse: desc })
      }
      continue
    }
    out.push(normalized)
  }
  return out
}

// ─── Validation ─────────────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true; entries: Array<Omit<SchoolMenuEntry, 'id' | 'childId'>> }
  | { ok: false; reason: 'duplicate_dates' | 'out_of_month' | 'too_many_per_week' | 'empty' }

/**
 * Sanity-checks parsed entries before either persistence or review:
 *  - No duplicate dates.
 *  - No more than ~5 entries per ISO week (school days only).
 *  - All dates fall within `anchor.month ± 1` (allows a menu that spans the
 *    last week of the previous month or the first of the next).
 *  - At least one entry.
 *
 * Returns the filtered list (sorted ascending) when valid. When invalid the
 * caller decides whether to surface the failure or fall back to the LLM.
 */
export function validateParsedEntries(
  entries: Array<Omit<SchoolMenuEntry, 'id' | 'childId'>>,
  anchor: MenuMonthAnchor
): ValidationResult {
  if (entries.length === 0) return { ok: false, reason: 'empty' }

  const seen = new Set<string>()
  for (const e of entries) {
    if (seen.has(e.date)) return { ok: false, reason: 'duplicate_dates' }
    seen.add(e.date)
  }

  const anchorIdx = anchor.year * 12 + (anchor.month - 1)
  for (const e of entries) {
    const [yStr, mStr] = e.date.split('-')
    const y = parseInt(yStr, 10)
    const monthVal = parseInt(mStr, 10)
    const idx = y * 12 + (monthVal - 1)
    if (Math.abs(idx - anchorIdx) > 1) return { ok: false, reason: 'out_of_month' }
  }

  // ISO-week bucket: count entries per (year, week#). Limit to 5 (Mon-Fri).
  const weekCounts = new Map<string, number>()
  for (const e of entries) {
    const key = isoWeekKey(e.date)
    weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1)
  }
  for (const count of weekCounts.values()) {
    if (count > 5) return { ok: false, reason: 'too_many_per_week' }
  }

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  return { ok: true, entries: sorted }
}

function isoWeekKey(iso: string): string {
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10))
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dayNum = dt.getUTCDay() || 7
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${dt.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

// ─── 2. Per-entry normalisation ─────────────────────────────────────────────

const ALLOWED_ALLERGENS = new Set([
  'gluten', 'dairy', 'eggs', 'peanuts', 'tree nuts', 'soy', 'fish',
  'shellfish', 'sesame', 'celery', 'mustard', 'lupin', 'mollusks', 'sulfites',
])

// Spanish + English course-label keywords. Match at the start of a line OR
// after a punctuation/whitespace boundary so a stray "primero" inside a
// dish name (rare) doesn't trip it.
const FIRST_COURSE_RE  = /(?:^|[.\n;·•\-]\s*)(?:primer\s*plato|primer[oa]|1[ºo°.]?\s*plato|first\s*course)\s*[:\-–.]\s*/i
const SECOND_COURSE_RE = /(?:^|[.\n;·•\-]\s*)(?:segundo\s*plato|segund[oa]|2[ºo°.]?\s*plato|second\s*course|main\s*course)\s*[:\-–.]\s*/i
const DESSERT_RE       = /(?:^|[.\n;·•\-]\s*)(?:postre|dessert|fruta\s+del?\s+d[ií]a)\s*[:\-–.]\s*/i

/**
 * Splits a single `description` string into firstCourse / secondCourse /
 * dessert when the parser can identify course markers. Falls back to
 * `undefined` for any course it can't isolate; the UI then renders
 * the raw `description` as a "Sin datos" companion or shows whichever
 * structured courses are available.
 *
 * The function ALSO trusts explicit fields the LLM may have produced —
 * if the entry already carries `firstCourse`/`secondCourse`/`dessert`,
 * we keep them and only fall back to keyword splitting when they are
 * absent.
 */
export function splitCourses(input: {
  description?: string
  firstCourse?: string
  secondCourse?: string
  dessert?: string
}): { firstCourse?: string; secondCourse?: string; dessert?: string } {
  const explicit = {
    firstCourse: cleanCourse(input.firstCourse),
    secondCourse: cleanCourse(input.secondCourse),
    dessert: cleanCourse(input.dessert),
  }
  // If the LLM produced any explicit structured field, trust it as-is.
  // Most Spanish school menus follow primero / segundo / postre verbatim.
  if (explicit.firstCourse || explicit.secondCourse || explicit.dessert) {
    return explicit
  }

  const text = (input.description ?? '').trim()
  if (!text) return {}

  // Strategy A: keyword-driven. Look for "Primer plato:", "Segundo plato:",
  // "Postre:" markers and slice between them.
  const fIdx = findCourseStart(text, FIRST_COURSE_RE)
  const sIdx = findCourseStart(text, SECOND_COURSE_RE)
  const dIdx = findCourseStart(text, DESSERT_RE)

  if (fIdx !== null || sIdx !== null || dIdx !== null) {
    const sorted = [fIdx, sIdx, dIdx]
      .filter((m): m is { start: number; bodyStart: number } => m !== null)
      .sort((a, b) => a.start - b.start)
    const bounds: Record<'first' | 'second' | 'dessert', { start: number; end: number } | null> = {
      first: null, second: null, dessert: null,
    }
    const idxMap = new Map<{ start: number; bodyStart: number }, 'first' | 'second' | 'dessert'>([
      ...(fIdx ? [[fIdx, 'first'] as const] : []),
      ...(sIdx ? [[sIdx, 'second'] as const] : []),
      ...(dIdx ? [[dIdx, 'dessert'] as const] : []),
    ])
    for (let i = 0; i < sorted.length; i++) {
      const key = idxMap.get(sorted[i])!
      const start = sorted[i].bodyStart
      const end = i + 1 < sorted.length ? sorted[i + 1].start : text.length
      bounds[key] = { start, end }
    }
    return {
      firstCourse: bounds.first   ? cleanCourse(text.slice(bounds.first.start,   bounds.first.end))   : undefined,
      secondCourse: bounds.second ? cleanCourse(text.slice(bounds.second.start, bounds.second.end)) : undefined,
      dessert:    bounds.dessert  ? cleanCourse(text.slice(bounds.dessert.start, bounds.dessert.end)) : undefined,
    }
  }

  // Strategy B: structural splits. If there are 2–4 clear line/bullet
  // boundaries, treat them as [first, second, dessert] in order.
  const segments = text
    .split(/\n+|(?:\s•\s)|(?:\s•\s)|(?:\s·\s)|(?:\s\|\s)/)
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0)

  if (segments.length >= 3) {
    // Assume the last short segment is the dessert (fruit / yoghurt /
    // pan / vaso de leche). If the last segment is suspiciously long
    // we instead leave the dessert undefined and don't guess.
    const dessertCandidate = segments[segments.length - 1]
    if (looksLikeDessert(dessertCandidate)) {
      return {
        firstCourse: cleanCourse(segments[0]),
        secondCourse: cleanCourse(segments.slice(1, -1).join('. ')),
        dessert: cleanCourse(dessertCandidate),
      }
    }
    return {
      firstCourse: cleanCourse(segments[0]),
      secondCourse: cleanCourse(segments[1]),
      dessert: cleanCourse(segments.slice(2).join('. ')),
    }
  }
  if (segments.length === 2) {
    return {
      firstCourse: cleanCourse(segments[0]),
      secondCourse: cleanCourse(segments[1]),
    }
  }
  // One line or unsplittable — leave structured fields empty; the UI
  // will show the raw description for that day.
  return {}
}

function findCourseStart(text: string, re: RegExp): { start: number; bodyStart: number } | null {
  const m = re.exec(text)
  if (!m) return null
  return { start: m.index, bodyStart: m.index + m[0].length }
}

function cleanCourse(s: string | undefined): string | undefined {
  if (!s) return undefined
  const trimmed = s
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:·•\-–|]+/, '')
    .replace(/[\s.,;:·•\-–|]+$/, '')
    .trim()
  if (trimmed.length === 0) return undefined
  return collapseRepeatedRuns(trimmed)
}

/**
 * Collapses consecutive identical word runs inside a course string.
 *
 *   "Fruta y Pan Fruta y Pan Fruta y Pan"  →  "Fruta y Pan"
 *   "Pollo asado pollo asado"              →  "Pollo asado"
 *
 * Targets the "parallel diet columns" artifact: when a Spanish menu publishes
 * the standard menu next to sin-gluten / sin-lactosa variants, the same
 * dessert text often appears 2-4 times in a row in the extracted PDF text.
 * Only IDENTICAL repeats are collapsed — close-but-different variants
 * ("Fruta y Pan" + "Fruta y Pan Integral") are left untouched for the
 * review modal to clean up manually.
 */
function collapseRepeatedRuns(s: string): string {
  const words = s.split(/\s+/).filter((w) => w.length > 0)
  // Need at least two words to have a repeat at all. The min-pattern length is
  // 1 word (e.g. "Yogur Yogur Yogur"), so anything below 2 is a no-op.
  if (words.length < 2) return s
  let changed = true
  while (changed) {
    changed = false
    const maxLen = Math.floor(words.length / 2)
    // Prefer collapsing the LONGEST repeated run first so we don't waste a
    // pass collapsing the 1-word overlap inside a 3-word repeat.
    outer: for (let len = maxLen; len >= 1; len--) {
      for (let i = 0; i + 2 * len <= words.length; i++) {
        const first = words.slice(i, i + len).join(' ').toLowerCase()
        const second = words.slice(i + len, i + 2 * len).join(' ').toLowerCase()
        if (first.length > 0 && first === second) {
          words.splice(i + len, len)
          changed = true
          break outer
        }
      }
    }
  }
  return words.join(' ')
}

// Common dessert keywords — short list, conservative on purpose so we
// don't mis-classify a heavy second course as a dessert.
const DESSERT_HINTS = [
  'fruta', 'yogur', 'yoghurt', 'yogurt', 'natillas', 'flan', 'gelatina',
  'helado', 'macedonia', 'compota', 'manzana', 'pera', 'plátano', 'platano',
  'naranja', 'mandarina', 'sandía', 'sandia', 'melón', 'melon', 'pan integral',
  'vaso de leche', 'leche', 'dessert', 'fruit',
]

function looksLikeDessert(segment: string): boolean {
  const low = segment.toLowerCase()
  if (low.length > 80) return false
  return DESSERT_HINTS.some((hint) => low.includes(hint))
}

/**
 * Builds a `SchoolMenuEntry`-shaped row (minus id/childId) from a raw
 * LLM-parsed entry. Drops malformed allergens, defaults missing arrays,
 * runs course-splitting on `description`. Returns `null` when the entry
 * lacks a usable date.
 *
 * ISO-date validation: anything that doesn't pattern-match `YYYY-MM-DD`
 * is rejected up-front. Letting bad dates through would corrupt the
 * `date` index in SQLite and silently break the "today + 4 days" sheet.
 */
export function normalizeSchoolMenuEntry(
  entry: SchoolMenuParsedEntry
): Omit<SchoolMenuEntry, 'id' | 'childId'> | null {
  if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return null

  // Sanitize BEFORE splitCourses so macronutrient lines and document
  // boilerplate never reach the course splitter. Apply to both the
  // freeform description and the per-course explicit fields the LLM
  // may have produced.
  const description = typeof entry.description === 'string'
    ? sanitizeMenuBody(entry.description.trim())
    : ''
  const courses = splitCourses({
    description,
    firstCourse: typeof entry.firstCourse === 'string' ? sanitizeMenuBody(entry.firstCourse) : entry.firstCourse,
    secondCourse: typeof entry.secondCourse === 'string' ? sanitizeMenuBody(entry.secondCourse) : entry.secondCourse,
    dessert: typeof entry.dessert === 'string' ? sanitizeMenuBody(entry.dessert) : entry.dessert,
  })

  const allergens = Array.isArray(entry.extractedAllergens)
    ? entry.extractedAllergens
        .map((a) => (typeof a === 'string' ? a.toLowerCase().trim() : ''))
        .filter((a) => ALLOWED_ALLERGENS.has(a))
    : []

  const ingredients = Array.isArray(entry.extractedIngredients)
    ? entry.extractedIngredients
        .filter((i): i is string => typeof i === 'string' && i.length > 0)
        .map((i) => i.toLowerCase().trim())
    : []

  return {
    date: entry.date,
    meal: 'lunch',
    description,
    firstCourse: courses.firstCourse,
    secondCourse: courses.secondCourse,
    dessert: courses.dessert,
    extractedIngredients: ingredients,
    extractedAllergens: allergens,
    nutritionalEstimate: entry.nutritionalEstimate,
  }
}

// ─── Geometric (per-line) parser ────────────────────────────────────────────
//
// PDFKit's `page.string` flattens the table into a single reading-order
// stream that, for typical Spanish school-menu grids, scrambles cells across
// columns and embeds day-number boxes inside dish text. The string-based
// `extractTableDayBlocks` recovers ~80% of the days but loses any cell whose
// marker shares a line with another column's marker (e.g. Balder May 2026,
// days 5 and 7).
//
// The geometric parser takes structured `PdfTextLine` records (one per line
// with bounding rect, produced by `expo-pdf-text.extractPdfTextLines`) and
// reconstructs the table by COLUMN GEOMETRY rather than by text position.
// Each weekday header anchors a column; lines are assigned to the column
// closest to their X; macro lines and large Y gaps split cells; embedded
// day markers slice each cell into dishes.

/** Lightweight shape — must match `PdfTextLine` from expo-pdf-text. */
export interface PdfLine {
  page: number
  text: string
  x: number
  y: number
  w: number
  h: number
}

const WEEKDAY_NAMES_NORM = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes']
const FOOTER_BOUNDARY_RE =
  /\b(?:fruta\s+variada|ensaladas\s*:|reglamento|al[eé]rgenos|elaborado\s+por|toda\s+la\s+informaci[oó]n)\b/i
const PURE_MARKER_LINE_RE = /^\s*\d{1,2}(?:\s+\d{1,2})*\s*$/
const EMBEDDED_MARKER_RE = /^(\d{1,2})\s+(.+)$/
const MACRO_LINE_DETECT_RE =
  /\b(?:k?cal|kj|hc|hidratos?|carbs?|lip(?:idos?)?|fats?|prot(?:eins?|e[ií]nas?)?|grasas?|saturated|ags|az[úu]car(?:es)?|sugars?|fibra|fiber|fibre|sodio|sodium|sal|colesterol|cholesterol|val(?:or)?\s+energ[eé]tico|energ[ií]a|energy|raci[oó]n)\b\s*[:=]/i

/**
 * Reconstructs a Spanish/English school-menu table from per-line geometric
 * extraction. Returns one entry per detected day-of-month cell.
 *
 * Algorithm:
 *  1. Find the five weekday header lines (Lunes/Martes/Miércoles/Jueves/Viernes).
 *     Their X positions anchor the five columns. Without 5 headers, this
 *     PDF isn't a weekday-grid menu — return [] so the caller falls back.
 *  2. Filter the body to lines below the headers and above the legal footer.
 *  3. Split "pure marker" lines like "5 6" or "7 8" into per-column marker
 *     hits — each digit is assigned to a sequential column starting at the
 *     column closest to the line's X.
 *  4. Wide lines that span multiple columns are heuristically split at
 *     estimated column boundaries (char-width × column-anchor X) with
 *     nearest-space snapping. Wide MACRO lines are treated as separators
 *     for all columns.
 *  5. Per column, group lines by macros and by Y-gap > 30pt into cells.
 *  6. Per cell, identify the day marker (pure, marker-only, or embedded
 *     "4 Macarrones") and collect remaining lines as the day's dishes.
 *  7. Emit one entry per (day, cell) pair, passing through
 *     `normalizeSchoolMenuEntry` for course splitting / sanitization.
 */
export function parseSchoolMenuViaGeometry(
  lines: PdfLine[],
  refDate: Date = new Date()
): { entries: Array<Omit<SchoolMenuEntry, 'id' | 'childId'>>; anchor: MenuMonthAnchor } {
  // Build a fallback anchor from the title line first (works without geometry).
  const titleText = lines
    .filter((l) => l.text.length > 6)
    .slice(0, 10)
    .map((l) => l.text)
    .join('\n')
  const anchor = extractDocumentMonthAnchor(titleText, refDate)

  if (lines.length === 0) return { entries: [], anchor }

  // 1. Weekday header detection (per page — assume single-page menu; for
  //    multi-page PDFs we'd run this loop once per page).
  const normalized = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
  const headerCandidates = lines.filter((l) => WEEKDAY_NAMES_NORM.includes(normalized(l.text)))
  // Dedupe: keep the FIRST occurrence of each weekday at the top of the page
  // (some PDFs repeat the header row per week-band).
  const seenHeaders = new Set<string>()
  const headers = headerCandidates.filter((l) => {
    const key = normalized(l.text)
    if (seenHeaders.has(key)) return false
    seenHeaders.add(key)
    return true
  })
  if (headers.length < 5) return { entries: [], anchor }

  const headersByX = [...headers].sort((a, b) => a.x - b.x)
  const colAnchorX = headersByX.slice(0, 5).map((h) => h.x)
  const headerY = headersByX[0].y
  const colWidth = colAnchorX[1] - colAnchorX[0]

  const colForX = (x: number): number => {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < colAnchorX.length; i++) {
      const d = Math.abs(x - colAnchorX[i])
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    return bestIdx
  }

  // 2. Body lines: below header, above any explicit footer line.
  const body = lines.filter(
    (l) =>
      l.y < headerY - 5 &&
      l.x > 30 &&
      l.text.trim().length > 0 &&
      !FOOTER_BOUNDARY_RE.test(l.text)
  )

  const isWide = (l: PdfLine) => l.w > colWidth * 1.4

  type ColLine = PdfLine & { _isMacros?: boolean; _isMarkerOnly?: boolean; _day?: number }

  // 3. Pure-marker line splitter: "5 6" → marker hits for day 5 (col closest
  //    to line.x) and day 6 (next column).
  const tryAsPureMarkerLine = (l: PdfLine): { col: number; day: number; y: number }[] | null => {
    const t = l.text.trim()
    if (!PURE_MARKER_LINE_RE.test(t)) return null
    const digits = t
      .split(/\s+/)
      .map((d) => parseInt(d, 10))
      .filter((d) => d >= 1 && d <= 31)
    if (digits.length === 0) return null
    const firstCol = colForX(l.x)
    return digits.map((day, i) => ({ col: firstCol + i, day, y: l.y }))
  }

  // 4. Wide-line splitter: estimate per-column substring via char-width and
  //    snap to nearest space. Imperfect but lets the user edit a row that
  //    would otherwise be silently dropped.
  const splitWideLine = (l: PdfLine): { col: number; text: string }[] => {
    const text = l.text
    const lineLen = text.length
    if (lineLen === 0 || l.w === 0) return []
    const pxPerChar = l.w / lineLen
    const coveredCols: number[] = []
    for (let c = 0; c < colAnchorX.length; c++) {
      if (colAnchorX[c] >= l.x - 30 && colAnchorX[c] <= l.x + l.w + 30) coveredCols.push(c)
    }
    if (coveredCols.length <= 1) return []
    const splits: number[] = []
    for (let i = 0; i + 1 < coveredCols.length; i++) {
      const midX = (colAnchorX[coveredCols[i]] + colAnchorX[coveredCols[i + 1]]) / 2
      let charPos = Math.round((midX - l.x) / pxPerChar)
      let bestSpace = -1
      let bestDist = Infinity
      const lo = Math.max(1, charPos - 8)
      const hi = Math.min(lineLen - 1, charPos + 8)
      for (let p = lo; p <= hi; p++) {
        if (text[p] === ' ' && Math.abs(p - charPos) < bestDist) {
          bestSpace = p
          bestDist = Math.abs(p - charPos)
        }
      }
      splits.push(bestSpace !== -1 ? bestSpace : charPos)
    }
    const segments: { col: number; text: string }[] = []
    let prev = 0
    for (let i = 0; i < splits.length; i++) {
      segments.push({ col: coveredCols[i], text: text.slice(prev, splits[i]).trim() })
      prev = splits[i] + 1
    }
    segments.push({
      col: coveredCols[coveredCols.length - 1],
      text: text.slice(prev).trim(),
    })
    return segments.filter((s) => s.text.length > 0)
  }

  // 5. Bucket lines into per-column arrays + collect cross-column marker hits.
  const byColumn: ColLine[][] = [[], [], [], [], []]
  const markerHits: { col: number; day: number; y: number }[] = []
  for (const l of body) {
    const markers = tryAsPureMarkerLine(l)
    if (markers && markers.length > 1) {
      for (const m of markers) {
        if (m.col >= 0 && m.col < 5) markerHits.push(m)
      }
      continue
    }
    if (isWide(l) && MACRO_LINE_DETECT_RE.test(l.text)) {
      // Wide macros line → separator for all columns.
      for (let c = 0; c < 5; c++) byColumn[c].push({ ...l, _isMacros: true })
      continue
    }
    if (isWide(l)) {
      const segs = splitWideLine(l)
      if (segs.length > 1) {
        for (const seg of segs) {
          byColumn[seg.col].push({
            page: l.page,
            text: seg.text,
            x: colAnchorX[seg.col],
            y: l.y,
            w: 100,
            h: l.h,
          })
        }
        continue
      }
      byColumn[colForX(l.x)].push(l)
      continue
    }
    const c = colForX(l.x)
    if (MACRO_LINE_DETECT_RE.test(l.text)) {
      byColumn[c].push({ ...l, _isMacros: true })
    } else {
      byColumn[c].push(l)
    }
  }

  // 6. Per column: sort by Y desc, split into cells by macros AND Y-gaps.
  const Y_GAP_BOUNDARY = 30
  const out: Array<Omit<SchoolMenuEntry, 'id' | 'childId'>> = []

  for (let c = 0; c < 5; c++) {
    const colMarkers: ColLine[] = markerHits
      .filter((m) => m.col === c)
      .map((m) => ({
        page: 0,
        text: String(m.day),
        x: colAnchorX[c],
        y: m.y,
        w: 10,
        h: 10,
        _isMarkerOnly: true,
        _day: m.day,
      }))
    const colLines = [...byColumn[c], ...colMarkers].sort((a, b) => b.y - a.y)

    const cells: ColLine[][] = []
    let cellLines: ColLine[] = []
    let prevY: number | null = null
    for (const l of colLines) {
      if (l._isMacros) {
        if (cellLines.length > 0) {
          cells.push(cellLines)
          cellLines = []
        }
        prevY = null
        continue
      }
      if (prevY !== null && prevY - l.y > Y_GAP_BOUNDARY) {
        if (cellLines.length > 0) {
          cells.push(cellLines)
          cellLines = []
        }
      }
      cellLines.push(l)
      prevY = l.y
    }
    if (cellLines.length > 0) cells.push(cellLines)

    for (const cell of cells) {
      let day: number | null = null
      const dishes: string[] = []
      for (const l of cell) {
        if (l._isMarkerOnly && l._day !== undefined) {
          day = l._day
          continue
        }
        const t = l.text.trim()
        const m = t.match(EMBEDDED_MARKER_RE)
        if (m) {
          const candidate = parseInt(m[1], 10)
          if (candidate >= 1 && candidate <= 31) {
            day = candidate
            dishes.push(m[2].trim())
            continue
          }
        }
        const m2 = t.match(/^(\d{1,2})$/)
        if (m2) {
          const candidate = parseInt(m2[1], 10)
          if (candidate >= 1 && candidate <= 31) {
            day = candidate
            continue
          }
        }
        dishes.push(t)
      }
      if (day === null) continue

      // Build an Entry by joining dishes with newlines so `splitCourses`
      // can map them to primer/segundo/postre via structural splits.
      const date = new Date(anchor.year, anchor.month - 1, day)
      const weekday = date.getDay()
      if (weekday === 0 || weekday === 6) continue
      const dateIso = localIsoDate(date)
      const description = dishes.join('\n')
      const normalized = normalizeSchoolMenuEntry({ date: dateIso, description })
      if (!normalized) continue
      if (!normalized.firstCourse && !normalized.secondCourse && !normalized.dessert) {
        const desc = normalized.description?.trim() ?? ''
        if (desc.length >= 3) {
          out.push({ ...normalized, firstCourse: desc })
        } else {
          // Empty cell — emit no-data placeholder.
          out.push({
            date: dateIso,
            meal: 'lunch',
            description: SCHOOL_MENU_NO_DATA_SENTINEL,
            extractedIngredients: [],
            extractedAllergens: [],
          })
        }
        continue
      }
      out.push(normalized)
    }
  }

  return { entries: out.sort((a, b) => a.date.localeCompare(b.date)), anchor }
}
