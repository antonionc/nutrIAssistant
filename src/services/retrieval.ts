import { DocChunkRow, getDocChunksForMember } from './memoryStore'

// Brute-force cosine over Float32Array. Embeddings models are normalised in
// theory, but we don't trust that — re-normalising costs nothing relative to
// the dot product itself, and a 384-dim dot product over <100 chunks runs in
// well under a millisecond on Hermes.
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
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
  if (chunks.length === 0) return []

  const scored: { chunk: DocChunkRow; score: number }[] = chunks.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored
    .filter((s) => s.score >= threshold)
    .slice(0, k)
    .map((s) => ({
      text: s.chunk.text,
      docId: s.chunk.docId,
      chunkIndex: s.chunk.chunkIndex,
      score: s.score,
    }))
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
  const tokens = new Set(
    query
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9áéíóúñ]+/i)
      .filter((t) => t.length >= 3)
  )
  if (tokens.size === 0) return items.slice(0, k)
  const scored = items.map((item) => {
    const text = getText(item)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
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
