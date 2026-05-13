import * as SQLite from 'expo-sqlite'

// Migration 015 — Foreign keys with ON DELETE CASCADE.
//
// Problem: profiles live in AsyncStorage (encrypted JSON blob), while
// `member_memories`, `doc_chunks`, `school_menu_entries`, and
// `conversation_summaries` keep `member_id` as a plain TEXT. SQLite
// cannot reference a key that lives outside the database, so the
// `PRAGMA foreign_keys = ON` we set in `database.ts` has nothing to
// enforce.
//
// Fix: introduce a thin `member_index` SQLite table that mirrors the
// minimum field needed for cascade deletes (the member ID). The
// `ProfilesContext` upserts/deletes rows in this table whenever it
// writes the AsyncStorage blob, keeping the two in sync. Then we
// rewrite the dependent tables with a real
// `FOREIGN KEY (member_id) REFERENCES member_index(id) ON DELETE CASCADE`.
//
// Why a separate index table and not "just move profiles to SQLite":
//   - Profiles already encrypt several fields per-row in AsyncStorage.
//     Moving them to SQLite would require a meaningful migration of
//     encryption layout (column-level vs blob-level). Out of scope.
//   - The cascade behaviour is what matters for governance / data-
//     hygiene; the storage of the rest of the profile is irrelevant
//     to the integrity contract.
//
// Pattern for adding the FK to an existing table:
//   1. CREATE TABLE <name>_new with the FK declared.
//   2. INSERT INTO <name>_new SELECT * FROM <name>.
//   3. DROP TABLE <name>; ALTER TABLE <name>_new RENAME TO <name>.
//   4. Re-create indexes.
//
// All of step 1-4 inside a single fn-migration so we can manage the
// transaction explicitly (SQL migrations are auto-wrapped; PRAGMA
// foreign_keys must be OFF during the rebuild, which cannot be done
// inside a transaction).

export async function migration015(db: SQLite.SQLiteDatabase): Promise<void> {
  // Step 1: create the member_index table if it does not yet exist.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS member_index (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Step 2: rebuild each dependent table with the FK declared. The
  // rebuild happens with PRAGMA foreign_keys=OFF outside any
  // transaction, then we set it back ON.
  await db.execAsync('PRAGMA foreign_keys = OFF;')

  await rebuildWithFk(db, {
    table: 'member_memories',
    createSql: `
      CREATE TABLE member_memories_new (
        id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL,
        encrypted_text TEXT NOT NULL,
        category TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (member_id) REFERENCES member_index(id) ON DELETE CASCADE
      );
    `,
    indexes: ['CREATE INDEX IF NOT EXISTS idx_member_memories_member ON member_memories(member_id);'],
  })

  // NOTE on the `embedding` column type. Migration 011 originally declared
  // `embedding BLOB NOT NULL`, but the code in `memoryStore.ts:127` writes
  // it via `encryptBytes(...)` which returns a base64 string. SQLite is
  // forgiving about type affinity (BLOB and TEXT both accept strings), so
  // production data wrote correctly to a BLOB-declared column. This
  // rebuild aligns the declared type with what is actually stored.
  // No data conversion is needed — the bytes on disk are identical.
  await rebuildWithFk(db, {
    table: 'doc_chunks',
    createSql: `
      CREATE TABLE doc_chunks_new (
        id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        encrypted_text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (member_id) REFERENCES member_index(id) ON DELETE CASCADE
      );
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_doc_chunks_member ON doc_chunks(member_id);',
      'CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON doc_chunks(doc_id);',
    ],
  })

  await rebuildWithFk(db, {
    table: 'conversation_summaries',
    createSql: `
      CREATE TABLE conversation_summaries_new (
        id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL,
        encrypted_summary TEXT NOT NULL,
        turns_covered INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (member_id) REFERENCES member_index(id) ON DELETE CASCADE
      );
    `,
    indexes: ['CREATE INDEX IF NOT EXISTS idx_conv_summaries_member ON conversation_summaries(member_id);'],
  })

  // `school_menu_entries.child_id` references a member, same pattern.
  // We don't rebuild it here because school_menu_entries has a richer
  // payload and breaking the FK constraint mid-update was previously a
  // source of bugs. Tracking as a follow-up in the data governance doc.

  await db.execAsync('PRAGMA foreign_keys = ON;')
}

interface RebuildSpec {
  table: string
  createSql: string
  indexes: string[]
}

async function rebuildWithFk(db: SQLite.SQLiteDatabase, spec: RebuildSpec): Promise<void> {
  // Skip if the FK already exists (idempotency / re-run safety). We
  // detect that by looking at the table schema in sqlite_master.
  const row = await db.getFirstAsync<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
    [spec.table],
  )
  if (row?.sql && row.sql.includes('FOREIGN KEY (member_id) REFERENCES member_index(id)')) {
    return
  }

  await db.withTransactionAsync(async () => {
    await db.execAsync(spec.createSql)
    await db.execAsync(`INSERT INTO ${spec.table}_new SELECT * FROM ${spec.table};`)
    await db.execAsync(`DROP TABLE ${spec.table};`)
    await db.execAsync(`ALTER TABLE ${spec.table}_new RENAME TO ${spec.table};`)
    for (const idxSql of spec.indexes) {
      await db.execAsync(idxSql)
    }
  })
}
