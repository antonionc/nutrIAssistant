// Adds the on-device memory layer used by the AI assistant:
//   - member_memories: durable facts auto-extracted from chat (encrypted)
//   - doc_chunks: PDF chunks + embedding vectors for semantic retrieval
//   - conversation_summaries: rolling summaries of older chat turns
// All free-text columns hold AES-GCM ciphertext; embeddings are raw float32 BLOBs.
export const migration011 = `
CREATE TABLE IF NOT EXISTS member_memories (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  encrypted_text TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_memories_member ON member_memories(member_id);

CREATE TABLE IF NOT EXISTS doc_chunks (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  encrypted_text TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_member ON doc_chunks(member_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON doc_chunks(doc_id);

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  encrypted_summary TEXT NOT NULL,
  turns_covered INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_summaries_member ON conversation_summaries(member_id);
`
