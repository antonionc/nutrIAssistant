import { getDatabase } from '../../db/database'
import { safeJsonParse } from '../../db/dbUtils'
import { MealPlan } from '../../types/planner'

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
  return row ? rowToPlan(row) : null
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
  return rows.map(rowToPlan)
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
