import { DocChunkRow, getDocChunksForMember, MemberMemory } from './memoryStore'

// Brute-force cosine over Float32Array. Embeddings models are normalised in
// theory, but we don't trust that — re-normalising costs nothing relative to
// the dot product itself, and a 384-dim dot product over <100 chunks runs in
// well under a millisecond on Hermes.
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export interface RetrievedChunk {
  text: string
  docId: string
  chunkIndex: number
  score: number
}

// Pure top-k cosine selection over already-loaded chunks. Split out from
// `retrievePdfChunks` so the AI testbed can assert RAG ranking / threshold
// behaviour without a database. Returns [] for a null query embedding (the
// embeddings model is not loaded) or when no chunk crosses the threshold.
export function selectTopChunks(
  chunks: DocChunkRow[],
  queryEmbedding: Float32Array | null,
  k: number = 2,
  threshold: number = 0.4
): RetrievedChunk[] {
  if (!queryEmbedding || chunks.length === 0) return []
  return chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .filter((s) => s.score >= threshold)
    .slice(0, k)
    .map((s) => ({
      text: s.chunk.text,
      docId: s.chunk.docId,
      chunkIndex: s.chunk.chunkIndex,
      score: s.score,
    }))
}

// Retrieves the top-k semantically closest PDF chunks for the given member.
// Returns [] if the member has no chunks indexed yet, the embedding is null
// (e.g. embeddings model not loaded), or no chunk crosses the threshold.
export async function retrievePdfChunks(
  memberId: string,
  queryEmbedding: Float32Array | null,
  k: number = 2,
  threshold: number = 0.4
): Promise<RetrievedChunk[]> {
  if (!queryEmbedding) return []
  const chunks = await getDocChunksForMember(memberId)
  return selectTopChunks(chunks, queryEmbedding, k, threshold)
}

// ─── Text utilities shared by the lexical rankers ────────────────────────────

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
}

// Query → set of content tokens (≥3 chars, accent-insensitive). Tokens
// shorter than 3 chars are dropped — they are almost always stopwords
// ("de", "el", "un") and inflate false matches.
function tokenizeQuery(query: string): Set<string> {
  return new Set(
    normalizeText(query)
      .split(/[^a-z0-9ñ]+/i)
      .filter((t) => t.length >= 3)
  )
}

// Cheap keyword-overlap ranking for pantry / favorites where embedding the
// whole inventory list is overkill. Returns items in the original order but
// truncated to the top-k by lexical match count against the query.
export function rankByKeywordOverlap<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  k: number
): T[] {
  const tokens = tokenizeQuery(query)
  if (tokens.size === 0) return items.slice(0, k)
  const scored = items.map((item) => {
    const text = normalizeText(getText(item))
    let score = 0
    for (const tok of tokens) {
      if (text.includes(tok)) score++
    }
    return { item, score }
  })
  // Stable: items with score>0 first, by score desc; then originals.
  scored.sort((a, b) => b.score - a.score)
  const matched = scored.filter((s) => s.score > 0).map((s) => s.item)
  if (matched.length >= k) return matched.slice(0, k)
  // Pad with the first non-matching items so we always return up to k.
  const fillers: T[] = []
  for (const s of scored) {
    if (s.score === 0 && fillers.length + matched.length < k) fillers.push(s.item)
  }
  return [...matched, ...fillers].slice(0, k)
}

// ─── Durable-memory relevance ranking ────────────────────────────────────────

// Normalised keyword overlap: fraction of query tokens found in the text,
// 0..1. The lexical fallback for memories whose embedding column is NULL.
function keywordRelevance(text: string, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0
  const norm = normalizeText(text)
  let hits = 0
  for (const tok of queryTokens) {
    if (norm.includes(tok)) hits++
  }
  return hits / queryTokens.size
}

// Hybrid relevance ranking for a member's durable facts. PURE + deterministic
// so the AI testbed can assert ranking without a DB or a loaded model.
//
// Why this exists: the prompt budget only fits ~5 memories. Pure recency
// ("last 5 facts saved") routinely buried a relevant older fact ("allergic
// to shellfish") under newer trivial ones. Each memory is scored against the
// live query and the top-k by relevance are surfaced instead:
//   - embedding present on BOTH query and memory → cosine similarity
//     (semantic: "what should I avoid?" matches "allergic to shellfish").
//   - otherwise → normalised keyword overlap (lexical fallback for memories
//     saved before migration 016 / before the embeddings model loaded).
// Ties — and the no-signal case (empty query, no embeddings) — fall back to
// recency, preserving the previous behaviour as a floor.
export function rankMemoriesByRelevance(
  memories: MemberMemory[],
  queryEmbedding: Float32Array | null,
  query: string,
  k: number
): MemberMemory[] {
  if (memories.length === 0) return []
  const queryTokens = tokenizeQuery(query)
  const scored = memories.map((memory) => {
    const score =
      queryEmbedding && memory.embedding
        ? Math.max(0, cosineSimilarity(queryEmbedding, memory.embedding))
        : keywordRelevance(memory.text, queryTokens)
    return { memory, score }
  })
  // Score desc; recency (createdAt desc) as a stable tie-breaker.
  scored.sort((a, b) => b.score - a.score || b.memory.createdAt.localeCompare(a.memory.createdAt))
  return scored.slice(0, k).map((s) => s.memory)
}
