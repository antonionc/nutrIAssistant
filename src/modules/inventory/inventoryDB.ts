import { getDatabase } from '../../db/database'
import { safeJsonParse } from '../../db/dbUtils'
import { InventoryItem } from '../../types/inventory'

function rowToItem(row: Record<string, unknown>): InventoryItem {
  return {
    id: row.id as string,
    name: row.name as string,
    category: row.category as InventoryItem['category'],
    quantity: row.quantity as number,
    unit: row.unit as InventoryItem['unit'],
    expiryDate: row.expiry_date as string | undefined,
    addedAt: row.added_at as string,
    imageUrl: row.image_url as string | undefined,
    nutritionalInfo: row.nutritional_info ? safeJsonParse(row.nutritional_info, undefined) : undefined,
    barcode: row.barcode as string | undefined,
    lowStockThreshold: row.low_stock_threshold as number | undefined,
  }
}

export async function getAllInventoryItems(): Promise<InventoryItem[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM inventory_items ORDER BY name ASC'
  )
  return rows.map(rowToItem)
}

export async function upsertInventoryItem(item: InventoryItem): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    `INSERT OR REPLACE INTO inventory_items
      (id, name, category, quantity, unit, expiry_date, added_at, image_url, nutritional_info, barcode, low_stock_threshold)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      item.id, item.name, item.category, item.quantity, item.unit,
      item.expiryDate ?? null, item.addedAt, item.imageUrl ?? null,
      item.nutritionalInfo ? JSON.stringify(item.nutritionalInfo) : null,
      item.barcode ?? null, item.lowStockThreshold ?? null,
    ]
  )
}

export async function deleteInventoryItem(id: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM inventory_items WHERE id = ?', [id])
}

export async function updateQuantity(id: string, newQuantity: number): Promise<void> {
  const db = await getDatabase()
  if (newQuantity <= 0) {
    await db.runAsync('DELETE FROM inventory_items WHERE id = ?', [id])
  } else {
    await db.runAsync(
      'UPDATE inventory_items SET quantity = ? WHERE id = ?',
      [newQuantity, id]
    )
  }
}

export async function getItemsByExpiryAlert(daysThreshold = 3): Promise<InventoryItem[]> {
  const db = await getDatabase()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + daysThreshold)
  const cutoffStr = cutoff.toISOString().split('T')[0]
  const todayStr = new Date().toISOString().split('T')[0]

  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM inventory_items
     WHERE expiry_date IS NOT NULL
       AND expiry_date >= ? AND expiry_date <= ?
     ORDER BY expiry_date ASC`,
    [todayStr, cutoffStr]
  )
  return rows.map(rowToItem)
}

export async function getExpiredItems(): Promise<InventoryItem[]> {
  const db = await getDatabase()
  const todayStr = new Date().toISOString().split('T')[0]
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM inventory_items
     WHERE expiry_date IS NOT NULL AND expiry_date < ?`,
    [todayStr]
  )
  return rows.map(rowToItem)
}
