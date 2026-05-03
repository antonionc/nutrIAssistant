import { getDatabase } from '../../db/database'
import { safeJsonParse } from '../../db/dbUtils'
import { Recipe, RecipeIngredient } from '../../types/recipes'
import { NutritionalInfo } from '../../types/nutrition'

function rowToRecipe(row: Record<string, unknown>): Recipe {
  return {
    id: row.id as string,
    name: row.name as string,
    nameEs: row.name_es as string | undefined,
    category: row.category as Recipe['category'],
    cuisine: row.cuisine as string,
    cuisineFlag: row.cuisine_flag as string | undefined,
    instructions: safeJsonParse(row.instructions, []),
    instructionsEs: row.instructions_es ? safeJsonParse(row.instructions_es, undefined) : undefined,
    ingredients: safeJsonParse(row.ingredients, []),
    prepTime: row.prep_time as number,
    cookTime: row.cook_time as number,
    servings: row.servings as number,
    imageUrl: row.image_url as string | undefined,
    localImagePath: row.local_image_path as string | undefined,
    sourceApi: row.source_api as Recipe['sourceApi'],
    sourceId: row.source_id as string | undefined,
    nutritionalInfo: safeJsonParse(row.nutritional_info, {} as Recipe['nutritionalInfo']),
    allergens: safeJsonParse(row.allergens, []),
    tags: safeJsonParse(row.tags, []),
    familyCompatibility: row.family_compatibility
      ? safeJsonParse(row.family_compatibility, undefined)
      : undefined,
    nutriscore: row.nutriscore as Recipe['nutriscore'],
    isFavorite: (row.is_favorite as number) === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function recipeToRow(r: Recipe) {
  return [
    r.id, r.name, r.nameEs ?? null, r.category, r.cuisine, r.cuisineFlag ?? null,
    JSON.stringify(r.instructions), r.instructionsEs ? JSON.stringify(r.instructionsEs) : null,
    JSON.stringify(r.ingredients), r.prepTime, r.cookTime, r.servings,
    r.imageUrl ?? null, r.localImagePath ?? null, r.sourceApi ?? null, r.sourceId ?? null,
    JSON.stringify(r.nutritionalInfo), JSON.stringify(r.allergens), JSON.stringify(r.tags),
    r.familyCompatibility ? JSON.stringify(r.familyCompatibility) : null,
    r.nutriscore ?? null, r.isFavorite ? 1 : 0, r.createdAt, r.updatedAt,
  ]
}

/**
 * Removes imageUrl from any recipe whose image URL is shared by 2+ recipes
 * with different names in the batch. Stock/placeholder CDN images are often
 * reused across unrelated recipes, producing wrong images in the UI.
 */
function deduplicateBatchImages(recipes: Recipe[]): Recipe[] {
  const urlNames = new Map<string, Set<string>>()
  for (const r of recipes) {
    if (!r.imageUrl) continue
    if (!urlNames.has(r.imageUrl)) urlNames.set(r.imageUrl, new Set())
    urlNames.get(r.imageUrl)!.add(r.name)
  }
  return recipes.map((r) => {
    if (!r.imageUrl) return r
    const names = urlNames.get(r.imageUrl)!
    return names.size > 1 ? { ...r, imageUrl: undefined } : r
  })
}

export async function batchUpsertRecipes(recipes: Recipe[]): Promise<void> {
  const cleaned = deduplicateBatchImages(recipes)
  const db = await getDatabase()
  await db.withTransactionAsync(async () => {
    for (const recipe of cleaned) {
      await db.runAsync(
        `INSERT OR REPLACE INTO recipes (
          id, name, name_es, category, cuisine, cuisine_flag,
          instructions, instructions_es, ingredients,
          prep_time, cook_time, servings,
          image_url, local_image_path, source_api, source_id,
          nutritional_info, allergens, tags, family_compatibility,
          nutriscore, is_favorite, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        recipeToRow(recipe)
      )
    }
  })
}

/**
 * Scans the entire recipes table and nulls out imageUrl for any URL that
 * appears across 2+ recipes with different names. Safe to call any time;
 * run after sync to clean up pre-existing bad images.
 */
export async function cleanDuplicateImageUrls(): Promise<number> {
  const db = await getDatabase()
  const result = await db.runAsync(
    `UPDATE recipes
     SET image_url = NULL, updated_at = ?
     WHERE image_url IS NOT NULL
       AND image_url IN (
         SELECT image_url FROM recipes
         WHERE image_url IS NOT NULL
         GROUP BY image_url
         HAVING COUNT(DISTINCT name) > 1
       )`,
    [new Date().toISOString()]
  )
  return result.changes
}

export async function getRecipeById(id: string): Promise<Recipe | null> {
  const db = await getDatabase()
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM recipes WHERE id = ?', [id]
  )
  return row ? rowToRecipe(row) : null
}

// Only recipes from verified, traceable sources are shown to users.
const VERIFIED_SOURCES = `source_api IN ('fatsecret', 'spoonacular', 'themealdb', 'user_created')`

export async function searchRecipes(
  query: string,
  limit = 20
): Promise<Recipe[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM recipes WHERE ${VERIFIED_SOURCES} AND (name LIKE ? OR cuisine LIKE ?) LIMIT ?`,
    [`%${query}%`, `%${query}%`, limit]
  )
  return rows.map(rowToRecipe)
}

export async function searchVerifiedByCategory(
  query: string,
  category: string,
  limit = 5
): Promise<Recipe[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM recipes WHERE ${VERIFIED_SOURCES} AND category = ? AND name LIKE ? LIMIT ?`,
    [category, `%${query}%`, limit]
  )
  return rows.map(rowToRecipe)
}

export async function getRecipesByCategory(
  category: string,
  limit = 20
): Promise<Recipe[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM recipes WHERE ${VERIFIED_SOURCES} AND category = ? LIMIT ?`,
    [category, limit]
  )
  return rows.map(rowToRecipe)
}

export async function getRecipesByCuisine(
  cuisine: string,
  limit = 20
): Promise<Recipe[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM recipes WHERE ${VERIFIED_SOURCES} AND cuisine LIKE ? LIMIT ?`,
    [`%${cuisine}%`, limit]
  )
  return rows.map(rowToRecipe)
}

export async function getAllRecipes(limit = 50, offset = 0): Promise<Recipe[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM recipes WHERE ${VERIFIED_SOURCES} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  )
  return rows.map(rowToRecipe)
}

export async function getRecipeCount(): Promise<number> {
  const db = await getDatabase()
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM recipes WHERE ${VERIFIED_SOURCES}`
  )
  return row?.count ?? 0
}

export async function toggleFavorite(id: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    'UPDATE recipes SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ?',
    [id]
  )
}

export async function updateRecipeCompatibility(
  id: string,
  compatibility: Record<string, unknown>
): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    'UPDATE recipes SET family_compatibility = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(compatibility), new Date().toISOString(), id]
  )
}


export interface RecipeFullDetail {
  prepTime: number
  cookTime: number
  servings: number
  instructions: string[]
  ingredients: RecipeIngredient[]
  nutritionalInfo: NutritionalInfo
  allergens: string[]
  imageUrl?: string
}

export async function updateRecipeFullDetail(
  id: string,
  detail: RecipeFullDetail
): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  if (detail.imageUrl) {
    await db.runAsync(
      `UPDATE recipes SET
        instructions = ?, ingredients = ?, prep_time = ?, cook_time = ?,
        servings = ?, nutritional_info = ?, allergens = ?, image_url = ?, updated_at = ?
      WHERE id = ?`,
      [
        JSON.stringify(detail.instructions),
        JSON.stringify(detail.ingredients),
        detail.prepTime,
        detail.cookTime,
        detail.servings,
        JSON.stringify(detail.nutritionalInfo),
        JSON.stringify(detail.allergens),
        detail.imageUrl,
        now,
        id,
      ]
    )
  } else {
    await db.runAsync(
      `UPDATE recipes SET
        instructions = ?, ingredients = ?, prep_time = ?, cook_time = ?,
        servings = ?, nutritional_info = ?, allergens = ?, updated_at = ?
      WHERE id = ?`,
      [
        JSON.stringify(detail.instructions),
        JSON.stringify(detail.ingredients),
        detail.prepTime,
        detail.cookTime,
        detail.servings,
        JSON.stringify(detail.nutritionalInfo),
        JSON.stringify(detail.allergens),
        now,
        id,
      ]
    )
  }
}

export async function updateRecipeTranslation(
  id: string,
  update: { nameEs?: string; instructionsEs?: string[] }
): Promise<void> {
  const parts: string[] = []
  const values: (string | null)[] = []
  if (update.nameEs !== undefined)        { parts.push('name_es = ?');        values.push(update.nameEs) }
  if (update.instructionsEs !== undefined){ parts.push('instructions_es = ?'); values.push(JSON.stringify(update.instructionsEs)) }
  if (parts.length === 0) return
  parts.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(id)
  const db = await getDatabase()
  await db.runAsync(`UPDATE recipes SET ${parts.join(', ')} WHERE id = ?`, values)
}

export async function wipeRecipesDatabase(): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM recipes')
}

export async function getRandomRecipes(
  limit = 6,
  category?: string
): Promise<Recipe[]> {
  const db = await getDatabase()
  const categoryClause = category ? `AND category = ?` : ''
  const params = category ? [category, limit] : [limit]
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM recipes WHERE ${VERIFIED_SOURCES} ${categoryClause} ORDER BY RANDOM() LIMIT ?`,
    params
  )
  return rows.map(rowToRecipe)
}
