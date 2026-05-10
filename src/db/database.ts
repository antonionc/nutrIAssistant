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
import { migration011 } from './migrations/011_memory_layer'
import { migration012 } from './migrations/012_drop_app_metadata'

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE LAYER — RULES FOR EDITORS
// ─────────────────────────────────────────────────────────────────────────────
// 1. Two sources of truth for the same columns, by design.
//    `001_initial.ts` defines the schema for *fresh installs*. Migrations
//    002+ exist to bring *existing installs* (whose 001 ran before a column
//    was added) up to the same shape. Both must stay in sync — if you change
//    a column default or NOT NULL constraint in 001, you must add a new
//    migration that performs the same change for installs in the wild.
//
// 2. Forward-only.
//    There are no down-migrations. A shipped migration cannot be edited or
//    deleted; if it turns out wrong, write a new one that corrects it.
//
// 3. Idempotency is mandatory.
//    Every migration must be safe to re-run. The runner has a "stale
//    migrations table" recovery path that re-executes everything from
//    scratch if the metadata is corrupted. Today every migration is
//    idempotent (`CREATE TABLE IF NOT EXISTS`, ALTER with `tolerateDuplicate`,
//    fn migrations doing existence checks). Do not break that invariant.
//
// 4. Multi-statement migrations need atomicity.
//    The runner wraps each `sql` migration in a SQLite transaction so
//    partial failures roll back cleanly. Keep your DDL transaction-safe:
//    avoid `PRAGMA foreign_keys` inside a `sql` migration (PRAGMA cannot be
//    changed inside a transaction). If you need PRAGMA control, write an
//    `fn` migration — those are NOT auto-wrapped, so the author owns
//    atomicity (see 008 for the pattern).
//
// 5. `tolerateDuplicate` is narrowly scoped.
//    It only swallows SQLite's "duplicate column name: …" error from
//    `ALTER TABLE … ADD COLUMN`. Any other failure still throws.
// ─────────────────────────────────────────────────────────────────────────────

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
  // fn migrations are NOT auto-wrapped in a transaction — see rule 4 above.
  // 008 needs to toggle PRAGMA foreign_keys, which is illegal inside one.
  { name: '008_grocery_rebuild', fn: migration008 },
  { name: '009_purge_themealdb', sql: migration009 },
  { name: '010_drop_unused_tables', sql: migration010 },
  { name: '011_memory_layer', sql: migration011 },
  { name: '012_drop_app_metadata', sql: migration012 },
]

// SQLite reports duplicate-column ALTERs as "duplicate column name: <name>".
// Match the exact phrase so we never silently swallow a different failure.
function isDuplicateColumnError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /duplicate column name/i.test(msg)
}

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
    // Stale migrations table from a previous dev session — reset it.
    // Safe today only because every migration is idempotent (see rule 3).
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
      // fn migrations manage their own atomicity (e.g. 008 must toggle
      // PRAGMA foreign_keys, which can't run inside a transaction).
      await migration.fn(database)
    } else {
      // sql migrations run inside a transaction so partial failures roll
      // back cleanly. `tolerateDuplicate` is checked AFTER the rollback so
      // a duplicate-column ALTER is still recorded as run.
      try {
        await database.withTransactionAsync(async () => {
          await database.execAsync(migration.sql)
        })
      } catch (err) {
        if (!(migration.tolerateDuplicate && isDuplicateColumnError(err))) throw err
        // Column already existed (fresh install path) — treat as a no-op.
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
