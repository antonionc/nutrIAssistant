// Qwen 3 1.7B has a "thinking mode" enabled by default — without /no_think it
// burns the entire output budget on a <think>…</think> reasoning block and
// never emits the JSON. Same directive used by buildSystemPrompt() for chat.
//
// The prompts ask explicitly for `firstCourse` / `secondCourse` / `dessert`
// because Spanish school menus are structurally a three-course table
// (primer plato, segundo plato, postre). When the LLM emits those fields
// directly, `splitCourses` in `schoolMenuParser.ts` trusts them verbatim;
// when it can only manage a flat `description`, the same splitter falls
// back to keyword + structural heuristics.
//
// Both prompts are produced by `buildSchoolMenuExtractionPrompt(anchor)` so
// the caller can pin the LLM to the menu's published month/year. Without
// this, Qwen 3 occasionally invents dates from previous months or shifts
// the year by one when the PDF is for a future month.

import type { MenuMonthAnchor } from '../schoolMenuParser'

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

function anchorMonthLabel(anchor: MenuMonthAnchor): string {
  const name = MONTH_NAMES_EN[anchor.month - 1] ?? `month ${anchor.month}`
  return `${name} ${anchor.year}`
}

function anchorExampleDate(anchor: MenuMonthAnchor, dayOfMonth: number): string {
  const safeDay = Math.max(1, Math.min(28, dayOfMonth))
  return `${anchor.year}-${String(anchor.month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
}

/**
 * Full-schema extraction prompt. Used when the simple-schema retry fails.
 * The anchor pins every emitted date to the published month/year so the
 * LLM cannot drift across months — a common failure on Qwen 3 1.7B when
 * the PDF lacks an in-context year.
 */
export function buildSchoolMenuExtractionPrompt(anchor: MenuMonthAnchor): string {
  const monthLabel = anchorMonthLabel(anchor)
  const ex1 = anchorExampleDate(anchor, 4)
  const ex2 = anchorExampleDate(anchor, 5)
  return `/no_think
You extract structured data from Spanish or English school lunch menu PDFs.

MONTHS IN SCOPE: ${monthLabel}. Every "date" you emit MUST be inside this month
(or the immediately adjacent month if the menu spans a week boundary).
Dates MUST be strictly monotonically increasing per calendar week, starting
on Monday. Do NOT use any other year.

Spanish school menus follow a strict three-course structure for each day:
  - primer plato  (first course, typically pasta / rice / legumes / soup)
  - segundo plato (second course, typically meat or fish with a side)
  - postre        (dessert, typically fruit, yoghurt, milk + bread)

TABLE-LAYOUT WARNING. Many school menus are published as a weekly grid
(one column per weekday × N rows of weeks). When PDF text is extracted
from such grids, courses for different days may arrive interleaved or
in column-scrambled order. DO NOT INVENT ASSIGNMENTS. Only emit a day
entry when you can ground every course against an explicit day-of-month
marker in the source text. If a day's courses are ambiguous, OMIT that
day entirely — a missing day is far better than wrong courses.

IGNORE ENTIRELY (these are NOT dishes):
- Nutritional summaries / macros: "HC", "Kcal", "Lip", "Prot", "Grasas",
  "AGS", "Fibra", "Sodio", "Energía", "Valor energético", "Ración" and any
  English equivalents ("kcal", "kJ", "carbs", "protein", "fat").
- Numeric-only values with or without units: "724", "32 g", "96,74", "30 %".
- Parallel diet-variant columns: when the menu publishes the standard menu
  next to "sin gluten" / "sin lactosa" / "sin huevo" / "vegetariano"
  versions, take ONLY the standard column. Do not concatenate variants.
- Page numbers, prices, "IVA incluido", "Elaborado por…", weekly totals,
  legal disclaimers, ingredient allergen icons.
- Weekend rows: Spanish school comedores only publish Monday–Friday. If
  the PDF accidentally shows a Saturday/Sunday cell, skip it.

For each school day in the PDF, output one object with:
- "date":           ISO date "YYYY-MM-DD" — must be inside ${monthLabel}.
- "firstCourse":    string — the primer plato for that day.
- "secondCourse":   string — the segundo plato for that day.
- "dessert":        string — the postre for that day (fruit, yoghurt, leche, pan…).
- "description":    string — fallback that concatenates the three courses if
                    you cannot tell them apart. Leave empty when the three
                    structured fields are populated.
- "extractedIngredients": array of main ingredient names (lowercase).
- "extractedAllergens":   array; pick ONLY from this exact list —
                    ["gluten","dairy","eggs","peanuts","tree nuts","soy",
                     "fish","shellfish","sesame","celery","mustard","lupin",
                     "mollusks","sulfites"]
- "nutritionalEstimate":  { "calories": number, "protein": number,
                            "carbs": number, "fat": number } — best estimate.

OUTPUT RULES (critical):
- Reply with ONLY a JSON array. Start with "[" and end with "]".
- No markdown, no code fences, no commentary before or after the array.
- Do not wrap the array in any object.
- One object per school day; do not merge multiple days into one entry.

EXAMPLE (two entries, dates pinned to ${monthLabel}):
[{"date":"${ex1}","firstCourse":"Lentejas con verduras","secondCourse":"Pollo asado con arroz","dessert":"Fruta y pan","description":"","extractedIngredients":["lentils","carrot","onion","chicken","rice"],"extractedAllergens":[],"nutritionalEstimate":{"calories":620,"protein":35,"carbs":70,"fat":18}},{"date":"${ex2}","firstCourse":"Macarrones con tomate","secondCourse":"Merluza al horno con ensalada","dessert":"Yogur natural","description":"","extractedIngredients":["pasta","tomato","hake","lettuce"],"extractedAllergens":["gluten","fish","dairy"],"nutritionalEstimate":{"calories":580,"protein":30,"carbs":75,"fat":15}}]`
}

/**
 * Simple-schema extraction prompt. Tried first because small models produce
 * minimal-shape JSON far more reliably. Caller fills in defaults for
 * ingredients / allergens / nutrition when this schema is used.
 */
export function buildSchoolMenuExtractionPromptSimple(anchor: MenuMonthAnchor): string {
  const monthLabel = anchorMonthLabel(anchor)
  const ex1 = anchorExampleDate(anchor, 4)
  const ex2 = anchorExampleDate(anchor, 5)
  return `/no_think
You extract Spanish or English school lunch menus from PDFs.

MONTHS IN SCOPE: ${monthLabel}. Every "date" MUST be inside this month.
Dates MUST be strictly increasing per calendar week. Do NOT use any other year.

TABLE LAYOUT: when the PDF is a weekly grid with columns per weekday, the
extracted text may arrive column-scrambled. Only emit a day when you can
ground its courses against the day-of-month marker. Omit ambiguous days.

IGNORE: nutritional summaries (HC, Kcal, Lip, Prot, Grasas, AGS, Fibra,
Sodio, Energía, kJ, carbs, protein, fat), numeric-only values, parallel
diet-variant columns (sin gluten / sin lactosa / sin huevo / vegetariano —
take only the standard column), page numbers, prices, legal text, weekly
totals, and weekend cells (Spanish comedores are Mon-Fri only).

For each school day, output one JSON object with:
- "date":         "YYYY-MM-DD" inside ${monthLabel}
- "firstCourse":  primer plato
- "secondCourse": segundo plato
- "dessert":      postre

OUTPUT RULES:
- Reply with ONLY a JSON array. Start with "[" and end with "]".
- No markdown, no code fences, no commentary.
- One object per day; do not concatenate multiple days.

EXAMPLE:
[{"date":"${ex1}","firstCourse":"Lentejas con verduras","secondCourse":"Pollo asado con arroz","dessert":"Fruta y pan"},{"date":"${ex2}","firstCourse":"Macarrones con tomate","secondCourse":"Merluza al horno","dessert":"Yogur"}]`
}
