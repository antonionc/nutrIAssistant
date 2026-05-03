import { Recipe, RecipeIngredient, RecipeCategory } from '../types/recipes'
import { NutritionalInfo } from '../types/nutrition'

const BASE = 'https://www.themealdb.com/api/json/v2/65232507'

// ─── Category mappings ─────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, RecipeCategory> = {
  Breakfast: 'breakfast',
  Dessert:   'dessert',
  Starter:   'lunch',
  Side:      'lunch',
}

// Estimated nutrition by TheMealDB category (they don't provide macros)
const CATEGORY_NUTRITION: Record<string, NutritionalInfo> = {
  Beef:         { calories: 520, protein: 35, carbs: 22, fat: 28 },
  Chicken:      { calories: 420, protein: 38, carbs: 18, fat: 15 },
  Lamb:         { calories: 480, protein: 32, carbs: 20, fat: 25 },
  Pork:         { calories: 460, protein: 33, carbs: 18, fat: 22 },
  Seafood:      { calories: 350, protein: 32, carbs: 16, fat: 12 },
  Pasta:        { calories: 490, protein: 18, carbs: 64, fat: 16 },
  Vegetarian:   { calories: 320, protein: 12, carbs: 44, fat: 10 },
  Vegan:        { calories: 280, protein: 10, carbs: 42, fat:  8 },
  Breakfast:    { calories: 380, protein: 14, carbs: 50, fat: 14 },
  Dessert:      { calories: 420, protein:  6, carbs: 66, fat: 18 },
  Starter:      { calories: 250, protein: 12, carbs: 22, fat: 10 },
  Side:         { calories: 200, protein:  6, carbs: 28, fat:  8 },
  Goat:         { calories: 380, protein: 28, carbs: 16, fat: 18 },
  Miscellaneous:{ calories: 400, protein: 18, carbs: 38, fat: 16 },
}

const DEFAULT_NUTRITION: NutritionalInfo = { calories: 400, protein: 20, carbs: 35, fat: 16 }

// Estimated prep/cook times by category (TheMealDB doesn't provide these)
const CATEGORY_TIMES: Record<string, { prep: number; cook: number }> = {
  Breakfast:    { prep: 10, cook: 15 },
  Dessert:      { prep: 20, cook: 30 },
  Starter:      { prep: 10, cook: 12 },
  Pasta:        { prep: 10, cook: 20 },
  Vegetarian:   { prep: 15, cook: 25 },
  Vegan:        { prep: 15, cook: 25 },
  Beef:         { prep: 15, cook: 45 },
  Lamb:         { prep: 15, cook: 50 },
  Pork:         { prep: 15, cook: 40 },
  Chicken:      { prep: 15, cook: 30 },
  Seafood:      { prep: 10, cook: 20 },
}

// Area (cuisine) → display name + flag
const AREA_FLAGS: Record<string, { cuisine: string; flag: string }> = {
  American:   { cuisine: 'American',   flag: '🇺🇸' },
  British:    { cuisine: 'British',    flag: '🇬🇧' },
  Canadian:   { cuisine: 'Canadian',   flag: '🇨🇦' },
  Chinese:    { cuisine: 'Chinese',    flag: '🇨🇳' },
  Croatian:   { cuisine: 'Croatian',   flag: '🇭🇷' },
  Dutch:      { cuisine: 'Dutch',      flag: '🇳🇱' },
  Egyptian:   { cuisine: 'Egyptian',   flag: '🇪🇬' },
  Filipino:   { cuisine: 'Filipino',   flag: '🇵🇭' },
  French:     { cuisine: 'French',     flag: '🇫🇷' },
  Greek:      { cuisine: 'Greek',      flag: '🇬🇷' },
  Indian:     { cuisine: 'Indian',     flag: '🇮🇳' },
  Irish:      { cuisine: 'Irish',      flag: '🇮🇪' },
  Italian:    { cuisine: 'Italian',    flag: '🇮🇹' },
  Jamaican:   { cuisine: 'Jamaican',   flag: '🇯🇲' },
  Japanese:   { cuisine: 'Japanese',   flag: '🇯🇵' },
  Kenyan:     { cuisine: 'Kenyan',     flag: '🇰🇪' },
  Malaysian:  { cuisine: 'Malaysian',  flag: '🇲🇾' },
  Mexican:    { cuisine: 'Mexican',    flag: '🇲🇽' },
  Moroccan:   { cuisine: 'Moroccan',   flag: '🇲🇦' },
  Polish:     { cuisine: 'Polish',     flag: '🇵🇱' },
  Portuguese: { cuisine: 'Portuguese', flag: '🇵🇹' },
  Russian:    { cuisine: 'Russian',    flag: '🇷🇺' },
  Spanish:    { cuisine: 'Spanish',    flag: '🇪🇸' },
  Thai:       { cuisine: 'Thai',       flag: '🇹🇭' },
  Tunisian:   { cuisine: 'Tunisian',   flag: '🇹🇳' },
  Turkish:    { cuisine: 'Turkish',    flag: '🇹🇷' },
  Ukrainian:  { cuisine: 'Ukrainian',  flag: '🇺🇦' },
  Vietnamese: { cuisine: 'Vietnamese', flag: '🇻🇳' },
}

// ─── Allergen detection ────────────────────────────────────────────────────

const ALLERGEN_PATTERNS: [RegExp, string][] = [
  [/\b(gluten|wheat|flour|bread|pasta|rye|barley|oat|spelt|semolina|bulgur|couscous|naan|pita)\b/i, 'gluten'],
  [/\b(milk|cream|cheese|butter|yoghurt|yogurt|whey|casein|ghee|cheddar|parmesan|mozzarella|brie)\b/i, 'dairy'],
  [/\b(egg|eggs|mayonnaise|mayo|meringue|custard)\b/i, 'eggs'],
  [/\bpeanut\b/i, 'peanuts'],
  [/\b(almond|cashew|walnut|pecan|pistachio|hazelnut|chestnut|macadamia|pine nut|brazil nut)\b/i, 'tree_nuts'],
  [/\b(soy|soya|tofu|edamame|miso|tempeh|soy sauce|soybean)\b/i, 'soy'],
  [/\b(salmon|tuna|cod|halibut|anchovy|sardine|bass|flounder|tilapia|trout|pollock)\b/i, 'fish'],
  [/\b(shrimp|prawn|crab|lobster|clam|oyster|mussel|scallop|squid|crayfish)\b/i, 'shellfish'],
  [/\bsesame\b/i, 'sesame'],
]

function detectAllergenType(name: string): string | undefined {
  for (const [pattern, allergen] of ALLERGEN_PATTERNS) {
    if (pattern.test(name)) return allergen
  }
  return undefined
}

function detectAllergens(ingredients: string[]): string[] {
  const found = new Set<string>()
  for (const ing of ingredients) {
    const a = detectAllergenType(ing)
    if (a) found.add(a)
  }
  return [...found]
}

// ─── Measure parsing ───────────────────────────────────────────────────────

function parseMeasureQuantity(measure?: string | null): number {
  if (!measure?.trim()) return 1
  const frac = measure.match(/(\d+)\s*\/\s*(\d+)/)
  if (frac) return parseInt(frac[1]) / parseInt(frac[2])
  const num = measure.match(/[\d.]+/)
  return num ? parseFloat(num[0]) : 1
}

function parseMeasureUnit(measure?: string | null): string {
  if (!measure?.trim()) return 'unit'
  const unit = measure.replace(/^[\d\s\/.-]+/, '').trim()
  return unit || 'unit'
}

// ─── Instructions parsing ──────────────────────────────────────────────────

function parseInstructions(raw: string): string[] {
  if (!raw?.trim()) return []
  // Split on numbered steps ("1. ", "STEP 1", etc.) or double newlines
  const steps = raw
    .split(/\r?\n\r?\n|\r?\n(?=\d+\s*[\.\)]\s)|(?=STEP\s+\d+)/i)
    .map((s) => s.replace(/^\s*\d+\s*[\.\)]\s*/, '').replace(/^STEP\s+\d+[:\s]*/i, '').trim())
    .filter((s) => s.length > 5)
  return steps.length > 0 ? steps : [raw.trim()]
}

// ─── Category → RecipeCategory ─────────────────────────────────────────────

function inferCategory(strCategory: string, idMeal: string): RecipeCategory {
  if (CATEGORY_MAP[strCategory]) return CATEGORY_MAP[strCategory]
  // Alternate between lunch and dinner based on ID parity
  return parseInt(idMeal, 10) % 2 === 0 ? 'dinner' : 'lunch'
}

// ─── Raw meal → Recipe ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mealToRecipe(raw: Record<string, any>): Recipe {
  const ingredients: RecipeIngredient[] = []
  for (let i = 1; i <= 20; i++) {
    const name: string | undefined = raw[`strIngredient${i}`]?.trim()
    if (!name) break
    const measure: string | undefined = raw[`strMeasure${i}`]
    const allergenType = detectAllergenType(name)
    ingredients.push({
      name,
      quantity: parseMeasureQuantity(measure),
      unit: parseMeasureUnit(measure),
      isAllergen: !!allergenType,
      allergenType,
    })
  }

  const category = raw.strCategory ?? ''
  const area: string = raw.strArea ?? 'Unknown'
  const areaInfo = AREA_FLAGS[area] ?? { cuisine: area || 'Internacional', flag: '🌍' }
  const nutrition = CATEGORY_NUTRITION[category] ?? DEFAULT_NUTRITION
  const times = CATEGORY_TIMES[category] ?? { prep: 15, cook: 30 }
  const tags: string[] = raw.strTags
    ? raw.strTags.split(',').map((t: string) => t.trim()).filter(Boolean)
    : []
  const allergens = detectAllergens(ingredients.map((i) => i.name))

  const now = new Date().toISOString()
  return {
    id: `mealdb-${raw.idMeal}`,
    name: raw.strMeal ?? 'Untitled',
    category: inferCategory(category, raw.idMeal ?? '0'),
    cuisine: areaInfo.cuisine,
    cuisineFlag: areaInfo.flag,
    instructions: parseInstructions(raw.strInstructions ?? ''),
    ingredients,
    prepTime: times.prep,
    cookTime: times.cook,
    servings: 4,
    imageUrl: raw.strMealThumb ?? undefined,
    sourceApi: 'themealdb',
    sourceId: raw.idMeal,
    nutritionalInfo: nutrition,
    allergens,
    tags,
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
  }
}

// ─── API fetching ──────────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMeals(data: Record<string, any> | null): Recipe[] {
  const raw = data?.meals
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m) => m?.idMeal && m?.strMeal)
    .map(mealToRecipe)
}

export type TheMealDBProgressCallback = (progress: number, message: string) => void

/**
 * Fetches all available recipes from TheMealDB:
 *   1. /latest.php — most recently added meals
 *   2. /search.php?f=[a-z] — full dataset by first letter (each response includes
 *      complete meal details, so no separate lookup calls are needed)
 */
export async function fetchAllTheMealDB(
  onProgress?: TheMealDBProgressCallback
): Promise<Recipe[]> {
  const seen = new Set<string>()
  const all: Recipe[] = []

  const addBatch = (recipes: Recipe[]) => {
    for (const r of recipes) {
      if (!seen.has(r.id)) {
        seen.add(r.id)
        all.push(r)
      }
    }
  }

  // Step 1: latest
  onProgress?.(0.02, 'Obteniendo últimas recetas de TheMealDB...')
  const latestData = await fetchJSON(`${BASE}/latest.php`)
  addBatch(extractMeals(latestData))

  // Step 2: A–Z full scan (26 calls, each returns full meal details)
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('')
  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i]
    const progress = 0.05 + (i / letters.length) * 0.9
    onProgress?.(progress, `Descargando recetas (${letter.toUpperCase()})...`)

    const data = await fetchJSON(`${BASE}/search.php?f=${letter}`)
    addBatch(extractMeals(data))

    // Brief pause to avoid hammering the API
    await new Promise((r) => setTimeout(r, 80))
  }

  onProgress?.(0.97, `${all.length} recetas obtenidas de TheMealDB`)
  return all
}
