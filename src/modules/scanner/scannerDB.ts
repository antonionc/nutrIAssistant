import { getDatabase } from '../../db/database'
import { safeJsonParse } from '../../db/dbUtils'
import { ScanResult } from '../../types/scanner'

function rowToScan(row: Record<string, unknown>): ScanResult {
  return {
    id: row.id as string,
    scanType: row.scan_type as ScanResult['scanType'],
    timestamp: row.timestamp as string,
    barcode: row.barcode as string | undefined,
    productName: row.product_name as string | undefined,
    brand: row.brand as string | undefined,
    imageUri: row.image_uri as string,
    nutritionalInfo: row.nutritional_info ? safeJsonParse(row.nutritional_info, undefined) : undefined,
    nutriscore: row.nutriscore as ScanResult['nutriscore'],
    allergens: safeJsonParse(row.allergens, []),
    ingredients: row.ingredients ? safeJsonParse(row.ingredients, undefined) : undefined,
    familyCompatibility: safeJsonParse(row.family_compatibility, {}),
    addedToInventory: (row.added_to_inventory as number) === 1,
    addedToCart: (row.added_to_cart as number) === 1,
  }
}

export async function saveScanResult(scan: ScanResult): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    `INSERT OR REPLACE INTO scan_history
      (id, scan_type, timestamp, barcode, product_name, brand, image_uri,
       nutritional_info, nutriscore, allergens, ingredients, family_compatibility,
       added_to_inventory, added_to_cart)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      scan.id, scan.scanType, scan.timestamp, scan.barcode ?? null,
      scan.productName ?? null, scan.brand ?? null, scan.imageUri,
      scan.nutritionalInfo ? JSON.stringify(scan.nutritionalInfo) : null,
      scan.nutriscore ?? null, JSON.stringify(scan.allergens),
      scan.ingredients ? JSON.stringify(scan.ingredients) : null,
      JSON.stringify(scan.familyCompatibility),
      scan.addedToInventory ? 1 : 0, scan.addedToCart ? 1 : 0,
    ]
  )
}

export async function getScanHistory(limit = 50): Promise<ScanResult[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM scan_history ORDER BY timestamp DESC LIMIT ?',
    [limit]
  )
  return rows.map(rowToScan)
}

export async function markAddedToInventory(id: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('UPDATE scan_history SET added_to_inventory = 1 WHERE id = ?', [id])
}

export async function markAddedToCart(id: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('UPDATE scan_history SET added_to_cart = 1 WHERE id = ?', [id])
}
