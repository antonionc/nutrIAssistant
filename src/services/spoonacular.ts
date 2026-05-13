import AsyncStorage from '@react-native-async-storage/async-storage'
import { Recipe, RecipeCategory, RecipeIngredient } from '../types/recipes'
import { NutritionalInfo } from '../types/nutrition'
import { computeNutriScore } from './nutriscore'
import { detectAllergensInIngredients } from '../modules/profiles/allergenEngine'

// All calls go through the BFF (https://api.nutriassistant.org). The BFF
// holds the Spoonacular API key in Cloudflare's secret store and enforces
// the global daily quota — no credentials ship in this binary.
const BFF_BASE = process.env.EXPO_PUBLIC_BFF_BASE_URL ?? 'https://api.nutriassistant.org'

export const SPOONACULAR_DAILY_LIMIT = 10_000

// Max stubs fetched per cuisine during bulk sync.
const MAX_PER_CUISINE = 1_000
const PAGE_SIZE = 100  // Spoonacular's maximum per request

// ─── Quota (read from BFF) ────────────────────────────────────────────────────
//
// The BFF tracks the daily counter globally across all users. We cache the
// response briefly in AsyncStorage so UI re-renders don't hammer the BFF.

const QUOTA_CACHE_KEY = 'sp_quota_cache_v2'
const QUOTA_CACHE_TTL_MS = 30_000

interface QuotaSnapshot { ts: number; used: number; limit: number; remaining: number }

async function fetchQuotaFromBFF(): Promise<QuotaSnapshot> {
  const cached = await AsyncStorage.getItem(QUOTA_CACHE_KEY)
  if (cached) {
    const parsed = JSON.parse(cached) as QuotaSnapshot
    if (Date.now() - parsed.ts < QUOTA_CACHE_TTL_MS) return parsed
  }
  try {
    const resp = await fetch(`${BFF_BASE}/v1/spoonacular/quota`)
    if (!resp.ok) throw new Error(`quota status ${resp.status}`)
    const data = (await resp.json()) as { used: number; limit: number; remaining: number }
    const snap: QuotaSnapshot = { ...data, ts: Date.now() }
    await AsyncStorage.setItem(QUOTA_CACHE_KEY, JSON.stringify(snap))
    return snap
  } catch {
    // BFF unreachable — assume full quota so the UI doesn't lock users out.
    return { ts: Date.now(), used: 0, limit: SPOONACULAR_DAILY_LIMIT, remaining: SPOONACULAR_DAILY_LIMIT }
  }
}

export async function getSpoonacularCallsToday(): Promise<number> {
  return (await fetchQuotaFromBFF()).used
}

export async function getSpoonacularCallsRemaining(): Promise<number> {
  return (await fetchQuotaFromBFF()).remaining
}

// ─── Spoonacular raw types ────────────────────────────────────────────────────

interface SPSearchResult { id: number; title: string; image?: string; imageType?: string }

interface SPSearchResponse {
  results: SPSearchResult[]
  offset: number
  number: number
  totalResults: number
}

interface SPNutrient { name: string; amount: number; unit: string }

interface SPIngredient { id?: number; name: string; amount: number; unit: string; original?: string }

interface SPStep { number: number; step: string }

interface SPInstruction { name: string; steps: SPStep[] }

interface SPRecipeInfo {
  id: number
  title: string
  image?: string
  readyInMinutes?: number
  preparationMinutes?: number
  cookingMinutes?: number
  servings?: number
  cuisines?: string[]
  dishTypes?: string[]
  extendedIngredients?: SPIngredient[]
  analyzedInstructions?: SPInstruction[]
  nutrition?: { nutrients: SPNutrient[] }
}

// ─── Category inference ───────────────────────────────────────────────────────

const DISH_TYPE_TO_CATEGORY: Record<string, RecipeCategory> = {
  'breakfast': 'breakfast', 'brunch': 'breakfast', 'morning meal': 'breakfast',
  'appetizer': 'lunch', 'salad': 'lunch', 'soup': 'lunch', 'starter': 'lunch',
  'antipasti': 'lunch', 'antipasto': 'lunch', "hor d'oeuvre": 'lunch',
  'main course': 'dinner', 'main dish': 'dinner', 'dinner': 'dinner',
  'dessert': 'dessert', 'sweet': 'dessert',
  'snack': 'snack', 'fingerfood': 'snack', 'drink': 'snack', 'beverage': 'snack',
  'lunch': 'lunch', 'side dish': 'dinner',
}

function inferCategory(dishTypes?: string[]): RecipeCategory {
  for (const dt of dishTypes ?? []) {
    const cat = DISH_TYPE_TO_CATEGORY[dt.toLowerCase()]
    if (cat) return cat
  }
  return 'dinner'
}

// ─── Cuisine catalogue ────────────────────────────────────────────────────────

export const SPOONACULAR_CUISINE_QUERIES: { cuisine: string; flag: string }[] = [
  { cuisine: 'mediterranean', flag: '🌊' },
  { cuisine: 'italian',       flag: '🇮🇹' },
  { cuisine: 'spanish',       flag: '🇪🇸' },
  { cuisine: 'greek',         flag: '🇬🇷' },
  { cuisine: 'french',        flag: '🇫🇷' },
  { cuisine: 'moroccan',      flag: '🇲🇦' },
  { cuisine: 'turkish',       flag: '🇹🇷' },
  { cuisine: 'japanese',      flag: '🇯🇵' },
  { cuisine: 'mexican',       flag: '🇲🇽' },
  { cuisine: 'indian',        flag: '🇮🇳' },
  { cuisine: 'chinese',       flag: '🇨🇳' },
  { cuisine: 'thai',          flag: '🇹🇭' },
  { cuisine: 'korean',        flag: '🇰🇷' },
  { cuisine: 'american',      flag: '🇺🇸' },
  { cuisine: 'middle eastern',flag: '🌙' },
  { cuisine: 'caribbean',     flag: '🏝️' },
  { cuisine: 'vietnamese',    flag: '🇻🇳' },
  { cuisine: 'german',        flag: '🇩🇪' },
  { cuisine: 'latin american',flag: '🌎' },
  { cuisine: 'african',       flag: '🌍' },
]

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Nutrition mapper ─────────────────────────────────────────────────────────

function mapNutrition(nutrients?: SPNutrient[]): NutritionalInfo {
  if (!nutrients) return { calories: 0, protein: 0, carbs: 0, fat: 0 }
  const get = (name: string) =>
    nutrients.find((n) => n.name.toLowerCase() === name.toLowerCase())?.amount ?? 0
  return {
    calories: Math.round(get('Calories')),
    protein:  get('Protein'),
    carbs:    get('Carbohydrates'),
    fat:      get('Fat'),
    fiber:    get('Fiber')  || undefined,
    sodium:   get('Sodium') || undefined,
  }
}

// ─── BFF helper ───────────────────────────────────────────────────────────────

class SpoonacularQuotaError extends Error {
  constructor() { super('Límite diario de Spoonacular alcanzado.') }
}

async function bffFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  const url = `${BFF_BASE}${path}${qs ? '?' + qs : ''}`
  const resp = await fetch(url)
  if (resp.status === 429) {
    // BFF returns 429 with `quota_exhausted` once today's global cap is hit.
    // Invalidate the local quota cache so the UI updates immediately.
    await AsyncStorage.removeItem(QUOTA_CACHE_KEY)
    throw new SpoonacularQuotaError()
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`[Spoonacular BFF] ${resp.status}: ${text.slice(0, 200)}`)
  }
  return resp.json() as Promise<T>
}

// ─── Stub builder ─────────────────────────────────────────────────────────────

function buildStub(r: SPSearchResult, cuisine: string, cuisineFlag: string): Recipe {
  const now = new Date().toISOString()
  // Spoonacular image URLs follow a predictable pattern based on the recipe ID.
  // Use the returned URL if present, otherwise construct it to guarantee images
  // are available for display before the lazy-load detail fetch runs.
  const imageUrl =
    r.image ??
    (r.imageType ? `https://spoonacular.com/recipeImages/${r.id}-636x393.${r.imageType}` : undefined)

  return {
    id: `sp-${r.id}`,
    name: r.title,
    category: 'dinner',
    cuisine: capitalise(cuisine),
    cuisineFlag,
    instructions: [],
    ingredients: [],
    prepTime: 15,
    cookTime: 30,
    servings: 4,
    imageUrl,
    sourceApi: 'spoonacular',
    sourceId: String(r.id),
    nutritionalInfo: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    allergens: [],
    tags: [],
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
  }
}

// ─── Public: paginated bulk search ───────────────────────────────────────────

export async function searchAllSpoonacularByCuisine(
  cuisine: string,
  cuisineFlag: string,
  onProgress?: (fetched: number, total: number) => void
): Promise<Recipe[]> {
  const all: Recipe[] = []
  let offset = 0
  let totalResults = Infinity

  while (offset < totalResults && all.length < MAX_PER_CUISINE) {
    let data: SPSearchResponse
    try {
      data = await bffFetch<SPSearchResponse>('/v1/spoonacular/complex-search', {
        cuisine,
        number: String(Math.min(PAGE_SIZE, MAX_PER_CUISINE - all.length)),
        offset: String(offset),
        sort:   'popularity',
      })
    } catch (e) {
      // Quota errors propagate so the sync orchestrator can stop early
      // with the right user-facing message.
      if (e instanceof SpoonacularQuotaError) throw e
      throw e
    }

    if (offset === 0) totalResults = data.totalResults
    if (!data.results.length) break

    for (const r of data.results) all.push(buildStub(r, cuisine, cuisineFlag))
    onProgress?.(all.length, Math.min(totalResults, MAX_PER_CUISINE))

    offset += data.results.length
    if (offset < totalResults && all.length < MAX_PER_CUISINE) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  return all
}

// Kept for backward compatibility (single-page fetch, used in settings + tests).
export async function searchSpoonacularByCuisine(
  cuisine: string,
  cuisineFlag: string,
  number = 50
): Promise<Recipe[]> {
  const data = await bffFetch<SPSearchResponse>('/v1/spoonacular/complex-search', {
    cuisine,
    number: String(Math.min(number, PAGE_SIZE)),
    sort:   'popularity',
  })

  return data.results.map((r) => buildStub(r, cuisine, cuisineFlag))
}

// ─── Public: recipe detail (lazy-loaded) ─────────────────────────────────────

export interface SpoonacularRecipeDetail {
  prepTime: number
  cookTime: number
  servings: number
  instructions: string[]
  ingredients: RecipeIngredient[]
  nutritionalInfo: NutritionalInfo
  allergens: string[]
  category: RecipeCategory
  nutriscore: ReturnType<typeof computeNutriScore>
  imageUrl?: string
}

export async function getSpoonacularRecipeDetail(
  spoonacularId: string
): Promise<SpoonacularRecipeDetail | null> {
  try {
    const data = await bffFetch<SPRecipeInfo>(`/v1/spoonacular/recipes/${spoonacularId}`, {
      includeNutrition: 'true',
    })

    const ingredientNames = (data.extendedIngredients ?? []).map((i) => i.name)
    const allergens = detectAllergensInIngredients(ingredientNames)
    const ingredients: RecipeIngredient[] = (data.extendedIngredients ?? []).map((i) => ({
      name:        i.name,
      quantity:    i.amount,
      unit:        i.unit || 'al gusto',
      isAllergen:  allergens.some((a) => i.name.toLowerCase().includes(a.toLowerCase())),
    }))

    const steps = (data.analyzedInstructions ?? [])
      .flatMap((block) => block.steps)
      .sort((a, b) => a.number - b.number)
      .map((s) => s.step)
      .filter(Boolean)

    const nutritionalInfo = mapNutrition(data.nutrition?.nutrients)

    return {
      prepTime:       (data.preparationMinutes ?? Math.round((data.readyInMinutes ?? 45) * 0.33)) || 15,
      cookTime:       (data.cookingMinutes     ?? Math.round((data.readyInMinutes ?? 45) * 0.67)) || 30,
      servings:       data.servings ?? 4,
      instructions:   steps,
      ingredients,
      nutritionalInfo,
      allergens,
      category:       inferCategory(data.dishTypes),
      nutriscore:     computeNutriScore(nutritionalInfo),
      imageUrl:       data.image ?? undefined,
    }
  } catch (e) {
    console.warn('[Spoonacular] getRecipeDetail failed:', e)
    return null
  }
}
