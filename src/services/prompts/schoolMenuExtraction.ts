// Qwen 3 1.7B has a "thinking mode" enabled by default — without /no_think it
// burns the entire output budget on a <think>…</think> reasoning block and
// never emits the JSON. Same directive used by buildSystemPrompt() for chat.
export const SCHOOL_MENU_EXTRACTION_PROMPT = `/no_think
You extract structured data from school lunch menu PDFs.

For each school day in the PDF, output one object with:
- "date":  ISO date "YYYY-MM-DD"
- "description":  the menu text exactly as it appears in the PDF
- "extractedIngredients":  array of main ingredient names (lowercase)
- "extractedAllergens":  array; pick ONLY from this exact list — ["gluten","dairy","eggs","peanuts","tree nuts","soy","fish","shellfish","sesame","celery","mustard","lupin","mollusks","sulfites"]
- "nutritionalEstimate":  { "calories": number, "protein": number, "carbs": number, "fat": number }  (your best estimate)

OUTPUT RULES (critical):
- Reply with ONLY a JSON array. Start with "[" and end with "]".
- No markdown, no code fences, no commentary before or after the array.
- Do not wrap the array in any object.

EXAMPLE of the exact output shape (two entries):
[{"date":"2026-05-04","description":"Lentejas con verduras y pollo asado con arroz","extractedIngredients":["lentils","carrot","onion","chicken","rice"],"extractedAllergens":[],"nutritionalEstimate":{"calories":620,"protein":35,"carbs":70,"fat":18}},{"date":"2026-05-05","description":"Macarrones con tomate y merluza al horno con ensalada","extractedIngredients":["pasta","tomato","hake","lettuce","tomato"],"extractedAllergens":["gluten","fish"],"nutritionalEstimate":{"calories":580,"protein":30,"carbs":75,"fat":15}}]`

// Fallback prompt used if the LLM's first response can't be parsed. Asks for
// a much simpler shape — just date+description — which small models produce
// far more reliably. The caller fills in defaults for the missing fields.
export const SCHOOL_MENU_EXTRACTION_PROMPT_SIMPLE = `/no_think
You extract school lunch menus from PDFs.

For each school day, output an object with:
- "date":  "YYYY-MM-DD"
- "description":  the menu text from the PDF

OUTPUT RULES:
- Reply with ONLY a JSON array. Start with "[" and end with "]".
- No markdown, no code fences, no commentary.

EXAMPLE:
[{"date":"2026-05-04","description":"Lentejas con pollo y arroz"},{"date":"2026-05-05","description":"Macarrones con merluza y ensalada"}]`
