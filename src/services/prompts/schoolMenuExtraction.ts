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
export const SCHOOL_MENU_EXTRACTION_PROMPT = `/no_think
You extract structured data from Spanish or English school lunch menu PDFs.

Spanish school menus follow a strict three-course structure for each day:
  - primer plato  (first course, typically pasta / rice / legumes / soup)
  - segundo plato (second course, typically meat or fish with a side)
  - postre        (dessert, typically fruit, yoghurt, milk + bread)

For each school day in the PDF, output one object with:
- "date":           ISO date "YYYY-MM-DD" — extract from the PDF, do not invent.
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

EXAMPLE (two entries):
[{"date":"2026-05-04","firstCourse":"Lentejas con verduras","secondCourse":"Pollo asado con arroz","dessert":"Fruta y pan","description":"","extractedIngredients":["lentils","carrot","onion","chicken","rice"],"extractedAllergens":[],"nutritionalEstimate":{"calories":620,"protein":35,"carbs":70,"fat":18}},{"date":"2026-05-05","firstCourse":"Macarrones con tomate","secondCourse":"Merluza al horno con ensalada","dessert":"Yogur natural","description":"","extractedIngredients":["pasta","tomato","hake","lettuce"],"extractedAllergens":["gluten","fish","dairy"],"nutritionalEstimate":{"calories":580,"protein":30,"carbs":75,"fat":15}}]`

// Fallback prompt used if the LLM's first response can't be parsed. Asks
// for the minimum shape (date + the three structured courses) — small
// models produce this far more reliably than the full schema. The caller
// fills in defaults for ingredients/allergens/nutrition.
export const SCHOOL_MENU_EXTRACTION_PROMPT_SIMPLE = `/no_think
You extract Spanish or English school lunch menus from PDFs.

For each school day, output one JSON object with:
- "date":         "YYYY-MM-DD"
- "firstCourse":  primer plato
- "secondCourse": segundo plato
- "dessert":      postre

OUTPUT RULES:
- Reply with ONLY a JSON array. Start with "[" and end with "]".
- No markdown, no code fences, no commentary.
- One object per day; do not concatenate multiple days.

EXAMPLE:
[{"date":"2026-05-04","firstCourse":"Lentejas con verduras","secondCourse":"Pollo asado con arroz","dessert":"Fruta y pan"},{"date":"2026-05-05","firstCourse":"Macarrones con tomate","secondCourse":"Merluza al horno","dessert":"Yogur"}]`
