import { getDatabase } from '../../db/database'
import { GroceryItem } from '../../types/groceries'

function rowToItem(row: Record<string, unknown>): GroceryItem {
  return {
    id: row.id as string,
    name: row.name as string,
    quantity: row.quantity as number,
    unit: row.unit as string,
    category: row.category as GroceryItem['category'],
    notes: row.notes as string | undefined,
    isPurchased: (row.is_purchased as number) === 1,
    addedAt: row.added_at as string,
    purchasedAt: row.purchased_at as string | undefined,
    fromMealPlan: (row.from_meal_plan as number) === 1,
    recipeId: row.recipe_id as string | undefined,
  }
}

export async function getAllGroceryItems(): Promise<GroceryItem[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM grocery_items ORDER BY category ASC, name ASC'
  )
  return rows.map(rowToItem)
}

export async function upsertGroceryItem(item: GroceryItem): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    `INSERT OR REPLACE INTO grocery_items
      (id, name, quantity, unit, category, notes, is_purchased, added_at, purchased_at, from_meal_plan, recipe_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      item.id, item.name, item.quantity, item.unit, item.category,
      item.notes ?? null, item.isPurchased ? 1 : 0, item.addedAt,
      item.purchasedAt ?? null, item.fromMealPlan ? 1 : 0, item.recipeId ?? null,
    ]
  )
}

export async function togglePurchasedDB(id: string): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  await db.runAsync(
    `UPDATE grocery_items
     SET is_purchased = CASE WHEN is_purchased = 1 THEN 0 ELSE 1 END,
         purchased_at = CASE WHEN is_purchased = 0 THEN ? ELSE NULL END
     WHERE id = ?`,
    [now, id]
  )
}

export async function deleteGroceryItem(id: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM grocery_items WHERE id = ?', [id])
}

export async function clearPurchasedItems(): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM grocery_items WHERE is_purchased = 1')
}

export async function findActiveItemByName(name: string): Promise<GroceryItem | null> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM grocery_items WHERE LOWER(name) = LOWER(?) AND is_purchased = 0 LIMIT 1',
    [name]
  )
  return rows.length > 0 ? rowToItem(rows[0]) : null
}

export async function updateGroceryItemQuantity(id: string, quantity: number): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('UPDATE grocery_items SET quantity = ? WHERE id = ?', [quantity, id])
}

export async function batchInsertGroceryItems(items: GroceryItem[]): Promise<void> {
  const db = await getDatabase()
  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await db.runAsync(
        `INSERT OR IGNORE INTO grocery_items
          (id, name, quantity, unit, category, notes, is_purchased, added_at, from_meal_plan, recipe_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          item.id, item.name, item.quantity, item.unit, item.category,
          item.notes ?? null, 0, item.addedAt, item.fromMealPlan ? 1 : 0, item.recipeId ?? null,
        ]
      )
    }
  })
}
