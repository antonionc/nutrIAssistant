// Migration 016 — Semantic-embedding column for member_memories.
//
// Adds a nullable `embedding` column so durable facts can be ranked by
// SEMANTIC similarity to the live query, not just by recency. Before this,
// `getTopMemoriesForMember` returned the 5 most-recent facts — a relevant
// older fact ("allergic to shellfish") could be pushed out of the prompt by
// 5 newer trivial ones. Embedding-ranked retrieval fixes that.
//
// Storage convention mirrors `doc_chunks`: the 384-dim MiniLM Float32Array
// is packed to bytes, AES-GCM encrypted, and stored base64 in a TEXT column.
// An embedding leaks its source text via inversion attacks, so it is
// encrypted exactly like any other free-text field.
//
// NULL means "not yet embedded" — `rankMemoriesByRelevance` falls back to
// keyword overlap for those rows, so the column is safe to add lazily and
// pre-existing memories keep working without a backfill.
export const migration016 = `
ALTER TABLE member_memories ADD COLUMN embedding TEXT;
`
