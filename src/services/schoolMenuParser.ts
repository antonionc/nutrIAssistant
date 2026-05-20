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
 * Deterministic parse of a raw PDF text. Returns normalized entries when
 * the text follows the canonical Spanish/English school-menu format
 * (day-of-week headers + course markers or three lines per day). Returns
 * an empty array when the format is too irregular — the caller then falls
 * back to the LLM.
 */
export function deterministicSchoolMenuParse(
  pdfText: string,
  refDate: Date = new Date()
): Array<Omit<SchoolMenuEntry, 'id' | 'childId'>> {
  const blocks = extractDayBlocks(pdfText, refDate)
  const out: Array<Omit<SchoolMenuEntry, 'id' | 'childId'>> = []
  for (const block of blocks) {
    const normalized = normalizeSchoolMenuEntry({ date: block.date, description: block.body })
    if (!normalized) continue
    // Only accept the entry when we identified at least one structured
    // course — a deterministic match with zero structure is no better than
    // skipping straight to the LLM.
    if (!normalized.firstCourse && !normalized.secondCourse && !normalized.dessert) continue
    out.push(normalized)
  }
  return out
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
  return trimmed.length > 0 ? trimmed : undefined
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

  const description = typeof entry.description === 'string' ? entry.description.trim() : ''
  const courses = splitCourses({
    description,
    firstCourse: entry.firstCourse,
    secondCourse: entry.secondCourse,
    dessert: entry.dessert,
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
