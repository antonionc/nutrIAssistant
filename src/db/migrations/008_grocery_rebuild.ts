import { SQLiteDatabase } from 'expo-sqlite'

/**
 * Reconstructs grocery_items to remove any unknown NOT NULL columns that
 * existed in older app schemas (e.g. list_id NOT NULL). SQLite has no
 * ALTER COLUMN / DROP COLUMN in older Android builds, so we copy-swap.
 */
export async function migration008(db: SQLiteDatabase): Promise<void> {
  // Detect columns actually present in the live table
  const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(grocery_items)')
  const has = (col: string) => cols.some((c) => c.name === col)

  // Only run if the table contains columns outside our known schema
  const knownCols = new Set([
    'id', 'name', 'quantity', 'unit', 'category', 'notes',
    'is_purchased', 'added_at', 'purchased_at', 'from_meal_plan', 'recipe_id',
  ])
  const hasUnknown = cols.some((c) => !knownCols.has(c.name))
  if (!hasUnknown) return

  // Build a safe SELECT that falls back for columns that may not exist yet
  const selectCols = [
    'id',
    'name',
    has('quantity')      ? 'quantity'      : '1 AS quantity',
    has('unit')          ? 'unit'          : "'units' AS unit",
    has('category')      ? 'category'      : "'other' AS category",
    has('notes')         ? 'notes'         : 'NULL AS notes',
    has('is_purchased')  ? 'is_purchased'  : '0 AS is_purchased',
    'added_at',
    has('purchased_at')  ? 'purchased_at'  : 'NULL AS purchased_at',
    has('from_meal_plan')? 'from_meal_plan': '0 AS from_meal_plan',
    has('recipe_id')     ? 'recipe_id'     : 'NULL AS recipe_id',
  ].join(', ')

  await db.execAsync('PRAGMA foreign_keys = OFF')
  try {
    await db.execAsync(`
      CREATE TABLE grocery_items_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit TEXT NOT NULL DEFAULT 'units',
        category TEXT NOT NULL DEFAULT 'other',
        notes TEXT,
        is_purchased INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL,
        purchased_at TEXT,
        from_meal_plan INTEGER NOT NULL DEFAULT 0,
        recipe_id TEXT
      );
      INSERT INTO grocery_items_new
        (id, name, quantity, unit, category, notes, is_purchased, added_at, purchased_at, from_meal_plan, recipe_id)
        SELECT ${selectCols} FROM grocery_items;
      DROP TABLE grocery_items;
      ALTER TABLE grocery_items_new RENAME TO grocery_items;
    `)
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON')
  }
}
