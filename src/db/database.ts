import * as SQLite from 'expo-sqlite'
import { migration001 } from './migrations/001_initial'
import { migration002 } from './migrations/002_grocery_is_purchased'
import { migration003 } from './migrations/003_grocery_notes'
import { migration004 } from './migrations/004_clear_seed_image_urls'
import { migration005 } from './migrations/005_grocery_purchased_at'
import { migration006 } from './migrations/006_grocery_from_meal_plan'
import { migration007 } from './migrations/007_grocery_recipe_id'
import { migration008 } from './migrations/008_grocery_rebuild'
import { migration009 } from './migrations/009_purge_themealdb'
import { migration010 } from './migrations/010_drop_unused_tables'

let db: SQLite.SQLiteDatabase | null = null

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('nutriassistant.db')
    await db.execAsync('PRAGMA journal_mode = WAL;')
    await db.execAsync('PRAGMA foreign_keys = ON;')
  }
  return db
}

type SqlMigration = { name: string; sql: string; tolerateDuplicate?: boolean }
type FnMigration = { name: string; fn: (db: SQLite.SQLiteDatabase) => Promise<void> }
type Migration = SqlMigration | FnMigration

const MIGRATIONS: Migration[] = [
  { name: '001_initial', sql: migration001 },
  { name: '002_grocery_is_purchased', sql: migration002, tolerateDuplicate: true },
  { name: '003_grocery_notes', sql: migration003, tolerateDuplicate: true },
  { name: '004_clear_seed_image_urls', sql: migration004 },
  { name: '005_grocery_purchased_at', sql: migration005, tolerateDuplicate: true },
  { name: '006_grocery_from_meal_plan', sql: migration006, tolerateDuplicate: true },
  { name: '007_grocery_recipe_id', sql: migration007, tolerateDuplicate: true },
  { name: '008_grocery_rebuild', fn: migration008 },
  { name: '009_purge_themealdb', sql: migration009 },
  { name: '010_drop_unused_tables', sql: migration010 },
]

export async function runMigrations(): Promise<void> {
  const database = await getDatabase()

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      run_at TEXT NOT NULL
    );
  `)

  let ran: { name: string }[] = []
  try {
    ran = await database.getAllAsync<{ name: string }>('SELECT name FROM migrations')
  } catch {
    // Stale migrations table from a previous dev session — reset it
    console.warn('[DB] Stale migrations table detected, resetting')
    await database.execAsync('DROP TABLE IF EXISTS migrations')
    await database.execAsync(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        run_at TEXT NOT NULL
      );
    `)
    ran = []
  }
  const ranNames = new Set(ran.map((r) => r.name))

  for (const migration of MIGRATIONS) {
    if (ranNames.has(migration.name)) continue

    if ('fn' in migration) {
      await migration.fn(database)
    } else {
      try {
        await database.execAsync(migration.sql)
      } catch (err) {
        if (!migration.tolerateDuplicate) throw err
        // Column may already exist on fresh installs — safe to ignore
      }
    }

    await database.runAsync(
      'INSERT INTO migrations (name, run_at) VALUES (?, ?)',
      [migration.name, new Date().toISOString()]
    )
    console.log(`[DB] Migration ${migration.name} completed`)
  }
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.closeAsync()
    db = null
  }
}
