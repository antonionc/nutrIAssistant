import AsyncStorage from '@react-native-async-storage/async-storage'
import { Recipe, RecipeCategory, RecipeIngredient } from '../types/recipes'
import { NutritionalInfo } from '../types/nutrition'
import { computeNutriScore } from './nutriscore'
import { detectAllergensInIngredients } from '../modules/profiles/allergenEngine'

const CLIENT_ID = process.env.EXPO_PUBLIC_FATSECRET_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.EXPO_PUBLIC_FATSECRET_CLIENT_SECRET ?? ''
const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token'
const API_BASE = 'https://platform.fatsecret.com/rest'
const TOKEN_KEY = 'fs_token'
const TOKEN_EXPIRY_KEY = 'fs_token_expiry'

// ─── Mediterranean search queries ────────────────────────────────────────────

interface MediterraneanQuery {
  expression: string
  cuisine: string
  flag: string
}

const MEDITERRANEAN_QUERIES: MediterraneanQuery[] = [
  { expression: 'Mediterranean',          cuisine: 'Mediterranean', flag: '🌊' },
  { expression: 'Mediterranean seafood',  cuisine: 'Mediterranean', flag: '🌊' },
  { expression: 'Italian pasta',          cuisine: 'Italian',       flag: '🇮🇹' },
  { expression: 'risotto',               cuisine: 'Italian',       flag: '🇮🇹' },
  { expression: 'bruschetta caprese',    cuisine: 'Italian',       flag: '🇮🇹' },
  { expression: 'Spanish paella tapas',  cuisine: 'Spanish',       flag: '🇪🇸' },
  { expression: 'gazpacho Spanish',      cuisine: 'Spanish',       flag: '🇪🇸' },
  { expression: 'Greek moussaka',        cuisine: 'Greek',         flag: '🇬🇷' },
  { expression: 'tzatziki souvlaki',     cuisine: 'Greek',         flag: '🇬🇷' },
  { expression: 'ratatouille French',    cuisine: 'French',        flag: '🇫🇷' },
  { expression: 'French Provencal',      cuisine: 'French',        flag: '🇫🇷' },
  { expression: 'Moroccan tagine',       cuisine: 'Moroccan',      flag: '🇲🇦' },
  { expression: 'couscous Moroccan',     cuisine: 'Moroccan',      flag: '🇲🇦' },
  { expression: 'Turkish kebab',         cuisine: 'Turkish',       flag: '🇹🇷' },
  { expression: 'Portuguese bacalhau',   cuisine: 'Portuguese',    flag: '🇵🇹' },
]

// ─── Recipe type → app category ──────────────────────────────────────────────

const RECIPE_TYPE_TO_CATEGORY: Record<string, RecipeCategory> = {
  'Breakfast': 'breakfast', 'Breads': 'breakfast',
  'Appetizers': 'lunch', 'Salads': 'lunch', 'Sandwiches': 'lunch', 'Soups': 'lunch',
  'Main Dishes': 'dinner', 'Casseroles': 'dinner', 'Side Dishes': 'dinner', 'Vegetables': 'dinner',
  'Desserts': 'dessert', 'Snacks': 'snack', 'Drinks': 'snack',
}

// ─── FatSecret raw types ──────────────────────────────────────────────────────

interface FSTokenResponse {
  access_token: string
  expires_in: number
}

interface FSRecipeNutrition {
  calories?: string
  carbohydrate?: string
  protein?: string
  fat?: string
  fiber?: string
  sodium?: string
  cholesterol?: string
}

interface FSRecipeStubRaw {
  recipe_id: string
  recipe_name: string
  recipe_description?: string
  recipe_image?: string
  recipe_types?: { recipe_type: string | string[] }
  recipe_nutrition?: FSRecipeNutrition
}

interface FSIngredient {
  food_name?: string
  number_of_units?: string
  measurement_description?: string
  ingredient_description?: string
}

interface FSDirection {
  direction_number?: string
  direction_description?: string
}

interface FSRecipeDetailRaw {
  recipe_id: string
  recipe_name: string
  recipe_description?: string
  recipe_image?: string
  preparation_time_min?: string
  cooking_time_min?: string
  number_of_servings?: string
  recipe_types?: { recipe_type: string | string[] }
  ingredients?: { ingredient: FSIngredient | FSIngredient[] }
  directions?: { direction: FSDirection | FSDirection[] }
  servings?: { serving: FSRecipeNutrition }
}

// ─── Utility: handles FatSecret's array-or-single-object quirk ───────────────

function toArray<T>(val: T | T[] | undefined | null): T[] {
  if (val === undefined || val === null) return []
  return Array.isArray(val) ? val : [val]
}

// ─── Token management ─────────────────────────────────────────────────────────

async function ensureToken(): Promise<string> {
  const [cached, expiryStr] = await Promise.all([
    AsyncStorage.getItem(TOKEN_KEY),
    AsyncStorage.getItem(TOKEN_EXPIRY_KEY),
  ])

  if (cached && expiryStr) {
    const expiry = parseInt(expiryStr, 10)
    if (Date.now() < expiry - 60_000) return cached  // valid for > 60 s
  }

  const credentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=basic',
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`[FatSecret] Token error ${resp.status}: ${text}`)
  }

  const data = (await resp.json()) as FSTokenResponse
  const expiry = Date.now() + data.expires_in * 1000

  await Promise.all([
    AsyncStorage.setItem(TOKEN_KEY, data.access_token),
    AsyncStorage.setItem(TOKEN_EXPIRY_KEY, String(expiry)),
  ])

  return data.access_token
}

// ─── API fetch helpers ────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = await ensureToken()
  const qs = new URLSearchParams({ ...params, format: 'json' }).toString()
  const resp = await fetch(`${API_BASE}${path}?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`[FatSecret] API error ${resp.status}: ${path}`)
  return resp.json() as Promise<T>
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function inferCategory(raw: FSRecipeStubRaw | FSRecipeDetailRaw): RecipeCategory {
  const types = toArray(raw.recipe_types?.recipe_type)
  for (const t of types) {
    const cat = RECIPE_TYPE_TO_CATEGORY[t]
    if (cat) return cat
  }
  return 'dinner'
}

function mapNutrition(n: FSRecipeNutrition | undefined): NutritionalInfo {
  if (!n) return { calories: 0, protein: 0, carbs: 0, fat: 0 }
  return {
    calories: Math.round(parseFloat(n.calories ?? '0')),
    protein: parseFloat(n.protein ?? '0'),
    carbs: parseFloat(n.carbohydrate ?? '0'),
    fat: parseFloat(n.fat ?? '0'),
    fiber: n.fiber ? parseFloat(n.fiber) : undefined,
    sodium: n.sodium ? parseFloat(n.sodium) : undefined,
  }
}

function mapIngredients(raw: FSRecipeDetailRaw): RecipeIngredient[] {
  const list = toArray(raw.ingredients?.ingredient)
  return list
    .filter((i) => !!i.food_name)
    .map((i) => ({
      name: i.food_name!,
      quantity: parseFloat(i.number_of_units ?? '1') || 1,
      unit: i.measurement_description ?? 'to taste',
      isAllergen: false,
    }))
}

function mapDirections(raw: FSRecipeDetailRaw): string[] {
  const list = toArray(raw.directions?.direction)
  return list
    .sort((a, b) => parseInt(a.direction_number ?? '0') - parseInt(b.direction_number ?? '0'))
    .map((d) => d.direction_description ?? '')
    .filter(Boolean)
}

// ─── Public: recipe detail ────────────────────────────────────────────────────

export interface FatSecretRecipeDetail {
  prepTime: number
  cookTime: number
  servings: number
  instructions: string[]
  ingredients: RecipeIngredient[]
  nutritionalInfo: NutritionalInfo
  allergens: string[]
  imageUrl?: string
}

export async function getRecipeDetail(recipeId: string): Promise<FatSecretRecipeDetail | null> {
  try {
    const data = await apiFetch<{ recipe: FSRecipeDetailRaw }>(
      '/recipe/v2',
      { recipe_id: recipeId }
    )
    const raw = data.recipe
    const ingredients = mapIngredients(raw)
    const allergens = detectAllergensInIngredients(ingredients.map((i) => i.name))
    const markedIngredients = ingredients.map((ing) => ({
      ...ing,
      isAllergen: allergens.some((a) => ing.name.toLowerCase().includes(a.toLowerCase())),
    }))
    const nutrition = mapNutrition(raw.servings?.serving)

    return {
      prepTime: parseInt(raw.preparation_time_min ?? '15', 10) || 15,
      cookTime: parseInt(raw.cooking_time_min ?? '30', 10) || 30,
      servings: parseFloat(raw.number_of_servings ?? '4') || 4,
      instructions: mapDirections(raw),
      ingredients: markedIngredients,
      nutritionalInfo: nutrition,
      allergens,
      imageUrl: raw.recipe_image ?? undefined,
    }
  } catch (e) {
    console.warn('[FatSecret] getRecipeDetail failed:', e)
    return null
  }
}

// ─── Public: Mediterranean bulk search ───────────────────────────────────────

export interface FatSecretRecipeStub {
  sourceId: string
  name: string
  imageUrl?: string
  category: RecipeCategory
  cuisine: string
  cuisineFlag: string
  nutritionalInfo: NutritionalInfo
}

async function searchRecipes(
  expression: string,
  maxResults = 50
): Promise<FSRecipeStubRaw[]> {
  const data = await apiFetch<{ recipes?: { recipe?: FSRecipeStubRaw | FSRecipeStubRaw[] } }>(
    '/recipes/search/v3',
    {
      search_expression: expression,
      max_results: String(maxResults),
      must_have_images: 'true',
    }
  )
  return toArray(data.recipes?.recipe)
}

export async function searchMediterraneanRecipes(
  onProgress?: (msg: string) => void
): Promise<Recipe[]> {
  const seen = new Map<string, Recipe>()
  const now = new Date().toISOString()

  for (const query of MEDITERRANEAN_QUERIES) {
    onProgress?.(`Buscando recetas ${query.cuisine}...`)
    try {
      const stubs = await searchRecipes(query.expression)
      for (const raw of stubs) {
        if (seen.has(raw.recipe_id)) continue
        const nutritionalInfo = mapNutrition(raw.recipe_nutrition)
        const nutriscore = computeNutriScore(nutritionalInfo)

        const recipe: Recipe = {
          id: `fs-${raw.recipe_id}`,
          name: raw.recipe_name,
          category: inferCategory(raw),
          cuisine: query.cuisine,
          cuisineFlag: query.flag,
          instructions: [],
          ingredients: [],
          prepTime: 15,
          cookTime: 30,
          servings: 4,
          imageUrl: raw.recipe_image ?? undefined,
          sourceApi: 'fatsecret',
          sourceId: raw.recipe_id,
          nutritionalInfo,
          allergens: [],
          tags: [],
          nutriscore,
          isFavorite: false,
          createdAt: now,
          updatedAt: now,
        }
        seen.set(raw.recipe_id, recipe)
      }
    } catch (e) {
      console.warn(`[FatSecret] Search failed for "${query.expression}":`, e)
    }

    // gentle rate limiting between queries
    await new Promise((r) => setTimeout(r, 200))
  }

  return Array.from(seen.values())
}
