import { Recipe, RecipeCategory, RecipeIngredient } from '../types/recipes'
import { NutritionalInfo } from '../types/nutrition'
import { computeNutriScore } from './nutriscore'
import { detectAllergensInIngredients } from '../modules/profiles/allergenEngine'

// All calls go through our BFF (https://api.nutriassistant.org). The BFF
// injects the Edamam app_id / app_key / account-user header server-side, so
// no Edamam credentials live in this binary.
const BFF_BASE = process.env.EXPO_PUBLIC_BFF_BASE_URL ?? 'https://api.nutriassistant.org'

// ─── Mediterranean search catalog ────────────────────────────────────────────

interface MediterraneanQuery {
  q: string
  cuisineType?: string
  cuisine: string
  flag: string
}

// Edamam's `cuisineType` covers Mediterranean, Italian, French, Middle Eastern
// directly. Spanish / Greek / Moroccan / Portuguese aren't first-class cuisine
// filters; rely on the free-text query for those — Edamam still returns
// thousands of results per term.
const EDAMAM_QUERIES: MediterraneanQuery[] = [
  { q: 'mediterranean', cuisineType: 'mediterranean',   cuisine: 'Mediterranean', flag: '🌊' },
  { q: 'seafood',        cuisineType: 'mediterranean',   cuisine: 'Mediterranean', flag: '🌊' },
  { q: 'pasta',          cuisineType: 'italian',         cuisine: 'Italian',       flag: '🇮🇹' },
  { q: 'risotto',        cuisineType: 'italian',         cuisine: 'Italian',       flag: '🇮🇹' },
  { q: 'bruschetta',     cuisineType: 'italian',         cuisine: 'Italian',       flag: '🇮🇹' },
  { q: 'paella',                                          cuisine: 'Spanish',       flag: '🇪🇸' },
  { q: 'tapas',                                           cuisine: 'Spanish',       flag: '🇪🇸' },
  { q: 'gazpacho',                                        cuisine: 'Spanish',       flag: '🇪🇸' },
  { q: 'moussaka',                                        cuisine: 'Greek',         flag: '🇬🇷' },
  { q: 'tzatziki',                                        cuisine: 'Greek',         flag: '🇬🇷' },
  { q: 'souvlaki',                                        cuisine: 'Greek',         flag: '🇬🇷' },
  { q: 'ratatouille',    cuisineType: 'french',          cuisine: 'French',        flag: '🇫🇷' },
  { q: 'provencal',      cuisineType: 'french',          cuisine: 'French',        flag: '🇫🇷' },
  { q: 'tagine',                                          cuisine: 'Moroccan',      flag: '🇲🇦' },
  { q: 'couscous',                                        cuisine: 'Moroccan',      flag: '🇲🇦' },
  { q: 'kebab',          cuisineType: 'middle eastern',  cuisine: 'Turkish',       flag: '🇹🇷' },
  { q: 'bacalhau',                                        cuisine: 'Portuguese',    flag: '🇵🇹' },
]

// ─── Edamam raw types (subset of Recipe Search v2 response we consume) ───────

interface EDNutrientValue { quantity: number; unit: string }

interface EDTotalNutrients {
  ENERC_KCAL?: EDNutrientValue   // calories
  PROCNT?: EDNutrientValue       // protein
  FAT?: EDNutrientValue          // fat
  CHOCDF?: EDNutrientValue       // carbohydrate
  FIBTG?: EDNutrientValue        // fiber
  SUGAR?: EDNutrientValue        // sugar
  NA?: EDNutrientValue           // sodium (mg)
  CA?: EDNutrientValue           // calcium (mg)
  FE?: EDNutrientValue           // iron (mg)
  FASAT?: EDNutrientValue        // saturated fat
  VITC?: EDNutrientValue         // vitamin C (mg)
}

interface EDIngredient {
  text?: string
  quantity?: number
  measure?: string | null
  food?: string
}

interface EDRecipe {
  uri: string                    // ".../recipe_<id>"
  label: string
  image?: string
  source?: string
  url?: string
  yield?: number
  ingredientLines?: string[]
  ingredients?: EDIngredient[]
  calories?: number              // whole-recipe total
  totalTime?: number
  cuisineType?: string[]
  mealType?: string[]
  dishType?: string[]
  dietLabels?: string[]
  healthLabels?: string[]
  totalNutrients?: EDTotalNutrients
}

interface EDHit { recipe: EDRecipe }

interface EDSearchResponse {
  from?: number
  to?: number
  count?: number
  hits?: EDHit[]
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

/**
 * Extracts Edamam's internal id (`recipe_<hex>`) from the URI suffix.
 * Returns null for malformed input so the caller can skip the record.
 */
function edamamIdFromUri(uri: string): string | null {
  const match = /#(recipe_[a-zA-Z0-9_]+)$/.exec(uri)
  return match ? match[1] : null
}

const MEAL_TYPE_TO_CATEGORY: Record<string, RecipeCategory> = {
  breakfast: 'breakfast',
  brunch: 'breakfast',
  'morning meal': 'breakfast',
  lunch: 'lunch',
  'lunch/dinner': 'dinner',     // Edamam often returns this combo — treat as dinner
  dinner: 'dinner',
  snack: 'snack',
  teatime: 'snack',
}

const DISH_TYPE_TO_CATEGORY: Record<string, RecipeCategory> = {
  'main course': 'dinner',
  'side dish': 'dinner',
  starter: 'lunch',
  salad: 'lunch',
  soup: 'lunch',
  sandwiches: 'lunch',
  bread: 'breakfast',
  cereals: 'breakfast',
  'biscuits and cookies': 'snack',
  desserts: 'dessert',
  sweets: 'dessert',
  'pancake': 'breakfast',
  pasta: 'dinner',
  pizza: 'dinner',
}

function inferCategory(recipe: EDRecipe): RecipeCategory {
  for (const m of recipe.mealType ?? []) {
    const cat = MEAL_TYPE_TO_CATEGORY[m.toLowerCase()]
    if (cat) return cat
  }
  for (const d of recipe.dishType ?? []) {
    const cat = DISH_TYPE_TO_CATEGORY[d.toLowerCase()]
    if (cat) return cat
  }
  return 'dinner'
}

/**
 * Edamam returns totals for the whole recipe; divide by `yield` to get per-
 * serving values. Sodium is reported in mg (NA), as are calcium/iron/vit-C —
 * NutritionalInfo expects mg too. Fiber/sugar/saturated-fat stay in grams.
 */
function mapNutrition(recipe: EDRecipe): NutritionalInfo {
  const servings = Math.max(1, recipe.yield ?? 1)
  const tn = recipe.totalNutrients ?? {}
  const per = (v?: EDNutrientValue) => (v ? v.quantity / servings : 0)

  return {
    calories: Math.round(per(tn.ENERC_KCAL) || (recipe.calories ?? 0) / servings),
    protein: per(tn.PROCNT),
    carbs: per(tn.CHOCDF),
    fat: per(tn.FAT),
    fiber: tn.FIBTG ? per(tn.FIBTG) : undefined,
    sugar: tn.SUGAR ? per(tn.SUGAR) : undefined,
    sodium: tn.NA ? per(tn.NA) : undefined,
    calcium: tn.CA ? per(tn.CA) : undefined,
    iron: tn.FE ? per(tn.FE) : undefined,
    saturatedFat: tn.FASAT ? per(tn.FASAT) : undefined,
    vitaminC: tn.VITC ? per(tn.VITC) : undefined,
  }
}

function mapIngredients(recipe: EDRecipe): RecipeIngredient[] {
  // Prefer the structured `ingredients` array; fall back to `ingredientLines`.
  if (recipe.ingredients && recipe.ingredients.length > 0) {
    return recipe.ingredients
      .filter((i) => !!i.food || !!i.text)
      .map((i) => ({
        name: (i.food ?? i.text ?? 'ingredient').trim(),
        quantity: typeof i.quantity === 'number' && i.quantity > 0 ? i.quantity : 1,
        unit: (i.measure ?? '').trim() || 'al gusto',
        isAllergen: false,
      }))
  }
  return (recipe.ingredientLines ?? []).map((line) => ({
    name: line.trim(),
    quantity: 1,
    unit: 'al gusto',
    isAllergen: false,
  }))
}

// ─── BFF fetch helper ────────────────────────────────────────────────────────

async function bffGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BFF_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const resp = await fetch(url.toString())
  if (!resp.ok) {
    throw new Error(`[Edamam] BFF ${path} returned ${resp.status}`)
  }
  return resp.json() as Promise<T>
}

// ─── Public: bulk Mediterranean search ───────────────────────────────────────

export async function searchMediterraneanRecipes(
  onProgress?: (msg: string) => void
): Promise<Recipe[]> {
  const seen = new Map<string, Recipe>()
  const now = new Date().toISOString()

  for (const query of EDAMAM_QUERIES) {
    onProgress?.(`Buscando recetas ${query.cuisine}...`)

    try {
      const params: Record<string, string> = { q: query.q }
      if (query.cuisineType) params.cuisineType = query.cuisineType

      const data = await bffGet<EDSearchResponse>('/v1/edamam/recipes/search', params)

      for (const hit of data.hits ?? []) {
        const raw = hit.recipe
        const edamamId = edamamIdFromUri(raw.uri)
        if (!edamamId) continue
        const dedupeKey = edamamId
        if (seen.has(dedupeKey)) continue

        const nutritionalInfo = mapNutrition(raw)
        const nutriscore = computeNutriScore(nutritionalInfo)

        const recipe: Recipe = {
          id: `em-${edamamId}`,
          name: raw.label,
          category: inferCategory(raw),
          cuisine: query.cuisine,
          cuisineFlag: query.flag,
          instructions: [],
          ingredients: [],
          prepTime: 15,
          cookTime: Math.max(15, Math.round((raw.totalTime ?? 45) - 15)),
          servings: Math.max(1, raw.yield ?? 4),
          imageUrl: raw.image,
          sourceApi: 'edamam',
          sourceId: edamamId,
          nutritionalInfo,
          allergens: [],
          tags: raw.dietLabels ?? [],
          nutriscore,
          isFavorite: false,
          createdAt: now,
          updatedAt: now,
        }
        seen.set(dedupeKey, recipe)
      }
    } catch (e) {
      console.warn(`[Edamam] Search failed for "${query.q}":`, e)
    }

    // Conservative pacing — Edamam Developer tier is 10 req/min.
    await new Promise((r) => setTimeout(r, 250))
  }

  return Array.from(seen.values())
}

// ─── Public: full recipe detail (lazy-loaded on open) ────────────────────────

export interface EdamamRecipeDetail {
  prepTime: number
  cookTime: number
  servings: number
  instructions: string[]
  ingredients: RecipeIngredient[]
  nutritionalInfo: NutritionalInfo
  allergens: string[]
  imageUrl?: string
}

/**
 * Edamam recipes don't include instructions — `source` + `url` point to the
 * publisher's website. We surface the structured ingredients + nutrition;
 * the assistant or the user can follow the original `url` for steps.
 */
export async function getRecipeDetail(edamamId: string): Promise<EdamamRecipeDetail | null> {
  try {
    const data = await bffGet<{ recipe: EDRecipe }>(`/v1/edamam/recipes/${edamamId}`, {})
    const raw = data.recipe
    const ingredients = mapIngredients(raw)
    const allergenNames = detectAllergensInIngredients(ingredients.map((i) => i.name))
    const markedIngredients = ingredients.map((ing) => ({
      ...ing,
      isAllergen: allergenNames.some((a) => ing.name.toLowerCase().includes(a.toLowerCase())),
    }))

    return {
      prepTime: 15,
      cookTime: Math.max(15, Math.round((raw.totalTime ?? 45) - 15)),
      servings: Math.max(1, raw.yield ?? 4),
      instructions: raw.ingredientLines ?? [],   // best-effort fallback
      ingredients: markedIngredients,
      nutritionalInfo: mapNutrition(raw),
      allergens: allergenNames,
      imageUrl: raw.image,
    }
  } catch (e) {
    console.warn('[Edamam] getRecipeDetail failed:', e)
    return null
  }
}
