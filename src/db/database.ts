import * as SQLite from 'expo-sqlite'
import { migration001 } from './migrations/001_initial'
import { migration002 } from './migrations/002_grocery_is_purchased'
import { migration003 } from './migrations/003_grocery_notes'
import { migration004 } from './migrations/004_clear_seed_image_urls'
import { migration005 } from './migrations/005_grocery_purchased_at'
import { migration006 } from './migrations/006_grocery_from_meal_plan'
import { migration007 } from './migrations/007_grocery_recipe_id'
import { migration008 } from './migrations/008_grocery_rebuild'

let db: SQLite.SQLiteDatabase | null = null

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('nutriassistant.db')
    await db.execAsync('PRAGMA journal_mode = WAL;')
    await db.execAsync('PRAGMA foreign_keys = ON;')
  }
  return db
}

export async function runMigrations(): Promise<void> {
  const database = await getDatabase()

  // Track which migrations have run
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

  if (!ranNames.has('001_initial')) {
    await database.execAsync(migration001)
    await database.runAsync(
      'INSERT INTO migrations (name, run_at) VALUES (?, ?)',
      ['001_initial', new Date().toISOString()]
    )
    console.log('[DB] Migration 001_initial completed')
  }

  if (!ranNames.has('002_grocery_is_purchased')) {
    try {
      await database.execAsync(migration002)
    } catch {
      // Column may already exist on fresh installs — safe to ignore
    }
    await database.runAsync(
      'INSERT INTO migrations (name, run_at) VALUES (?, ?)',
      ['002_grocery_is_purchased', new Date().toISOString()]
    )
    console.log('[DB] Migration 002_grocery_is_purchased completed')
  }

  if (!ranNames.has('003_grocery_notes')) {
    try {
      await database.execAsync(migration003)
    } catch {
      // Column may already exist on fresh installs — safe to ignore
    }
    await database.runAsync(
      'INSERT INTO migrations (name, run_at) VALUES (?, ?)',
      ['003_grocery_notes', new Date().toISOString()]
    )
    console.log('[DB] Migration 003_grocery_notes completed')
  }

  if (!ranNames.has('004_clear_seed_image_urls')) {
    await database.execAsync(migration004)
    await database.runAsync(
      'INSERT INTO migrations (name, run_at) VALUES (?, ?)',
      ['004_clear_seed_image_urls', new Date().toISOString()]
    )
    console.log('[DB] Migration 004_clear_seed_image_urls completed')
  }

  if (!ranNames.has('005_grocery_purchased_at')) {
    try {
      await database.execAsync(migration005)
    } catch {
      // Column already exists on fresh installs — safe to ignore
    }
    await database.runAsync(
      'INSERT INTO migrations (name, run_at) VALUES (?, ?)',
      ['005_grocery_purchased_at', new Date().toISOString()]
    )
    console.log('[DB] Migration 005_grocery_purchased_at completed')
  }

  if (!ranNames.has('006_grocery_from_meal_plan')) {
    try {
      await database.execAsync(migration006)
    } catch {
      // Column already exists on fresh installs — safe to ignore
    }
    await database.runAsync(
      'INSERT INTO migrations (name, run_at) VALUES (?, ?)',
      ['006_grocery_from_meal_plan', new Date().toISOString()]
    )
    console.log('[DB] Migration 006_grocery_from_meal_plan completed')
  }

  if (!ranNames.has('007_grocery_recipe_id')) {
    try {
      await database.execAsync(migration007)
    } catch {
      // Column already exists on fresh installs — safe to ignore
    }
    await database.runAsync(
      'INSERT INTO migrations (name, run_at) VALUES (?, ?)',
      ['007_grocery_recipe_id', new Date().toISOString()]
    )
    console.log('[DB] Migration 007_grocery_recipe_id completed')
  }

  if (!ranNames.has('008_grocery_rebuild')) {
    await migration008(database)
    await database.runAsync(
      'INSERT INTO migrations (name, run_at) VALUES (?, ?)',
      ['008_grocery_rebuild', new Date().toISOString()]
    )
    console.log('[DB] Migration 008_grocery_rebuild completed')
  }
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.closeAsync()
    db = null
  }
}
