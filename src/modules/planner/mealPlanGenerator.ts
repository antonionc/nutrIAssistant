import { Recipe, RecipeCategory } from '../../types/recipes'
import { FamilyMember } from '../../types/profiles'
import { getRandomRecipes } from '../recipes/recipeDB'
import {
  generateOnDevice,
  getLLMStatus,
} from '../../services/onDeviceLlm'
import { logger } from '../../utils/logger'

const POOL_SIZE = 50
const LLM_CANDIDATES = 14
const WEEK_DAYS = 7

type MealCategory = Extract<RecipeCategory, 'breakfast' | 'lunch' | 'dinner'>

export interface WeekRecipes {
  breakfasts: Recipe[]
  lunches: Recipe[]
  dinners: Recipe[]
}

interface CandidatePools {
  breakfast: Recipe[]
  lunch: Recipe[]
  dinner: Recipe[]
}

// ─── Pool building ────────────────────────────────────────────────────────────

async function buildSafeCandidatePools(profiles: FamilyMember[]): Promise<CandidatePools> {
  const familyAllergens = new Set(
    profiles.flatMap((p) => (p.allergies ?? []) as string[])
  )
  const isSafe = (r: Recipe) =>
    familyAllergens.size === 0 ||
    !(r.allergens ?? []).some((a) => familyAllergens.has(a))

  async function fetchSafePool(category: MealCategory): Promise<Recipe[]> {
    const raw = await getRandomRecipes(POOL_SIZE, category)
    const safe = raw.filter(isSafe)
    // If allergen filtering left fewer than a week's worth, fall back to the
    // unfiltered pool — better than repeating the same 2 recipes every day.
    return safe.length >= WEEK_DAYS ? safe : raw
  }

  const [breakfast, lunch, dinner] = await Promise.all([
    fetchSafePool('breakfast'),
    fetchSafePool('lunch'),
    fetchSafePool('dinner'),
  ])
  return { breakfast, lunch, dinner }
}

// ─── Algorithmic picker ───────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Picks 7 recipes from pool with no repeats and cuisine rotation:
// no two consecutive days share the same cuisine when possible.
function pickAlgorithmic(pool: Recipe[]): Recipe[] {
  if (pool.length === 0) return []
  const shuffled = shuffle(pool)
  const picked: Recipe[] = []
  const usedIds = new Set<string>()
  const recentCuisines: string[] = []

  for (let day = 0; day < WEEK_DAYS; day++) {
    let next = shuffled.find(
      (r) => !usedIds.has(r.id) && !recentCuisines.slice(-2).includes(r.cuisine)
    )
    if (!next) next = shuffled.find((r) => !usedIds.has(r.id))
    if (!next) next = shuffled[day % shuffled.length]
    picked.push(next)
    usedIds.add(next.id)
    recentCuisines.push(next.cuisine)
  }
  return picked
}

// ─── LLM picker ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You select recipes for a meal plan. Reply only with the requested format. Do not explain.'

function buildLlmPrompt(category: MealCategory, candidates: Recipe[]): string {
  const list = candidates
    .map((r, i) => `${i + 1}. ${r.name} (${r.cuisine})`)
    .join('\n')
  return `Pick 7 different ${category} recipes from this list, one for each day of the week. Maximize variety in cuisines and dishes. Do not repeat any number.

${list}

Reply with ONLY 7 numbers separated by commas, like: 3,7,1,12,5,9,2`
}

// Parse 7 unique 1-based indices from LLM output. Returns null on any failure.
function parseLlmIndices(text: string, max: number): number[] | null {
  const matches = text.match(/\d+/g)
  if (!matches) return null
  const valid = matches
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= max)
  const unique: number[] = []
  for (const n of valid) {
    if (!unique.includes(n)) unique.push(n)
    if (unique.length === WEEK_DAYS) break
  }
  return unique.length === WEEK_DAYS ? unique : null
}

async function pickWithLlm(
  category: MealCategory,
  pool: Recipe[]
): Promise<Recipe[] | null> {
  if (pool.length < WEEK_DAYS) return null
  const candidates = shuffle(pool).slice(0, LLM_CANDIDATES)
  const prompt = buildLlmPrompt(category, candidates)
  try {
    const out = await generateOnDevice(prompt, SYSTEM_PROMPT)
    const indices = parseLlmIndices(out, candidates.length)
    if (!indices) {
      logger.warn(`[MealPlan] LLM ${category} output unparseable, falling back`)
      return null
    }
    return indices.map((i) => candidates[i - 1])
  } catch (e) {
    logger.warn(`[MealPlan] LLM ${category} call failed:`, e)
    return null
  }
}

// ─── Public entry point ──────────────────────────────────────────────────────

export async function selectWeekRecipes(profiles: FamilyMember[]): Promise<WeekRecipes> {
  const pools = await buildSafeCandidatePools(profiles)

  const status = await getLLMStatus()
  const useLlm = status.isLoaded

  // Run sequentially: a single LLM instance can't process parallel inferences.
  // Each call independently falls back to the algorithmic picker on failure.
  let breakfasts: Recipe[]
  let lunches: Recipe[]
  let dinners: Recipe[]

  if (useLlm) {
    breakfasts = (await pickWithLlm('breakfast', pools.breakfast)) ?? pickAlgorithmic(pools.breakfast)
    lunches    = (await pickWithLlm('lunch',     pools.lunch))     ?? pickAlgorithmic(pools.lunch)
    dinners    = (await pickWithLlm('dinner',    pools.dinner))    ?? pickAlgorithmic(pools.dinner)
  } else {
    breakfasts = pickAlgorithmic(pools.breakfast)
    lunches    = pickAlgorithmic(pools.lunch)
    dinners    = pickAlgorithmic(pools.dinner)
  }

  return { breakfasts, lunches, dinners }
}
