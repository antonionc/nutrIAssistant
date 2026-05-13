import { getDatabase } from '../../db/database'
import { safeJsonParse } from '../../db/dbUtils'
import { MealPlan } from '../../types/planner'
import { Recipe } from '../../types/recipes'
import { getRecipesByIds } from '../recipes/recipeDB'

function rowToPlan(row: Record<string, unknown>): MealPlan {
  return {
    id: row.id as string,
    date: row.date as string,
    meals: {
      breakfast: row.breakfast_recipe_id
        ? safeJsonParse(row.breakfast_recipe_id, undefined)
        : undefined,
      lunch: row.lunch_recipe_id
        ? safeJsonParse(row.lunch_recipe_id, undefined)
        : undefined,
      dinner: row.dinner_recipe_id
        ? safeJsonParse(row.dinner_recipe_id, undefined)
        : undefined,
    },
    memberTargets: safeJsonParse(row.member_targets, {}),
    schoolMenuContext: row.school_menu_context
      ? safeJsonParse(row.school_menu_context, undefined)
      : undefined,
    isLocked: (row.is_locked as number) === 1,
    generatedAt: row.generated_at as string,
    updatedAt: row.updated_at as string,
  }
}

// Each meal recipe is stored as a frozen JSON snapshot of the Recipe at the
// time the plan was generated. Older plans were saved before Edamam started
// populating `imageUrl`, so their snapshots lack a thumbnail even though the
// live catalog row now has one. We backfill the image (and only the image)
// from the live recipes table at read time, falling back to the snapshot
// when the recipe is no longer in the catalog (deleted, ad-hoc AI-generated).
//
// This is the FAST PATH for the common case: catalog row already has a
// thumbnail (synced or previously enriched). MealCard then renders without
// any further DB roundtrip.
//
// The SLOW PATH lives in `useResolvedRecipeImage` inside MealCard.tsx — it
// handles the case where even the live catalog row is a stub (un-enriched
// or nulled by `cleanDuplicateImageUrls`) by triggering the same lazy
// `enrichRecipeDetail`/`enrichSpoonacularDetail` flow the recipe-detail
// screen uses. The two layers are complementary, not redundant.
async function hydratePlanImages(plans: MealPlan[]): Promise<void> {
  const idsToHydrate = new Set<string>()
  for (const plan of plans) {
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
      const r = plan.meals[slot]
      if (r && !r.imageUrl) idsToHydrate.add(r.id)
    }
  }
  if (idsToHydrate.size === 0) return

  const live = await getRecipesByIds([...idsToHydrate])
  const liveById = new Map<string, Recipe>(live.map((r) => [r.id, r]))

  for (const plan of plans) {
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
      const snapshot = plan.meals[slot]
      if (!snapshot || snapshot.imageUrl) continue
      const liveImage = liveById.get(snapshot.id)?.imageUrl
      if (liveImage) snapshot.imageUrl = liveImage
    }
  }
}

export async function upsertMealPlan(plan: MealPlan): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  await db.runAsync(
    `INSERT OR REPLACE INTO meal_plans
      (id, date, breakfast_recipe_id, lunch_recipe_id, dinner_recipe_id,
       member_targets, school_menu_context, is_locked, generated_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      plan.id,
      plan.date,
      plan.meals.breakfast ? JSON.stringify(plan.meals.breakfast) : null,
      plan.meals.lunch ? JSON.stringify(plan.meals.lunch) : null,
      plan.meals.dinner ? JSON.stringify(plan.meals.dinner) : null,
      JSON.stringify(plan.memberTargets),
      plan.schoolMenuContext ? JSON.stringify(plan.schoolMenuContext) : null,
      plan.isLocked ? 1 : 0,
      plan.generatedAt,
      now,
    ]
  )
}

export async function getMealPlanForDate(date: string): Promise<MealPlan | null> {
  const db = await getDatabase()
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM meal_plans WHERE date = ?',
    [date]
  )
  if (!row) return null
  const plan = rowToPlan(row)
  await hydratePlanImages([plan])
  return plan
}

export async function getMealPlansForRange(
  startDate: string,
  endDate: string
): Promise<MealPlan[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM meal_plans WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [startDate, endDate]
  )
  const plans = rows.map(rowToPlan)
  await hydratePlanImages(plans)
  return plans
}

export async function toggleLockPlan(date: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    `UPDATE meal_plans
     SET is_locked = CASE WHEN is_locked = 1 THEN 0 ELSE 1 END,
         updated_at = ?
     WHERE date = ?`,
    [new Date().toISOString(), date]
  )
}

export async function saveSchoolMenuEntry(entry: {
  id: string
  date: string
  childId: string
  description: string
  extractedIngredients: string[]
  extractedAllergens: string[]
  nutritionalEstimate?: { calories: number; protein: number; carbs: number; fat: number }
}): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    `INSERT OR REPLACE INTO school_menu_entries
      (id, date, child_id, meal, description, extracted_ingredients, extracted_allergens, nutritional_estimate)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      entry.id, entry.date, entry.childId, 'lunch',
      entry.description,
      JSON.stringify(entry.extractedIngredients),
      JSON.stringify(entry.extractedAllergens),
      entry.nutritionalEstimate ? JSON.stringify(entry.nutritionalEstimate) : null,
    ]
  )
}

export async function deleteSchoolMenuEntriesForChild(childId: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM school_menu_entries WHERE child_id = ?', [childId])
}

export async function getSchoolMenuChildIds(): Promise<string[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT DISTINCT child_id FROM school_menu_entries ORDER BY child_id ASC'
  )
  return rows.map((row) => row.child_id as string)
}

export async function getSchoolMenuEntries(childId: string): Promise<Array<{
  id: string; date: string; childId: string; description: string;
  extractedIngredients: string[]; extractedAllergens: string[];
  nutritionalEstimate?: { calories: number; protein: number; carbs: number; fat: number }
}>> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM school_menu_entries WHERE child_id = ? ORDER BY date ASC',
    [childId]
  )
  return rows.map((row) => ({
    id: row.id as string,
    date: row.date as string,
    childId: row.child_id as string,
    description: row.description as string,
    extractedIngredients: safeJsonParse(row.extracted_ingredients, []),
    extractedAllergens: safeJsonParse(row.extracted_allergens, []),
    nutritionalEstimate: row.nutritional_estimate
      ? safeJsonParse(row.nutritional_estimate, undefined)
      : undefined,
  }))
}
