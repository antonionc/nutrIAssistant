/**
 * AI TESTBED — Memory & RAG retrieval
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies the two retrieval paths that personalize NutriBot's answers:
 *   1. Durable-fact ranking — `rankMemoriesByRelevance` surfaces the facts
 *      relevant to THIS query, not just the most recent ones. A relevant
 *      older fact ("allergic to shellfish") must beat 5 recent trivial ones.
 *   2. Clinical-PDF RAG — `selectTopChunks` returns the top-k chunks above
 *      the similarity threshold, in score order.
 *
 * All functions under test are pure, so this suite needs no DB and no model.
 * Run via `npm run testbed`. See ./README.md for when to re-run.
 */
import { cosineSimilarity, selectTopChunks, rankMemoriesByRelevance } from '../../services/retrieval'
import { DocChunkRow, MemberMemory } from '../../services/memoryStore'

const vec = (...n: number[]): Float32Array => Float32Array.from(n)

const chunk = (id: string, embedding: Float32Array, text = `chunk ${id}`): DocChunkRow => ({
  id, memberId: 'm', docId: 'doc-1', chunkIndex: 0, text, embedding, createdAt: '2026-01-01T00:00:00Z',
})

const mem = (
  text: string,
  createdAt: string,
  embedding?: Float32Array
): MemberMemory => ({
  id: `mem-${text.slice(0, 6)}`, memberId: 'm', text, category: 'preference', createdAt, embedding,
})

// ─── 1. Cosine similarity (RAG math primitive) ───────────────────────────────

describe('Memory & RAG · cosine similarity', () => {
  it('scores identical vectors at 1', () => {
    expect(cosineSimilarity(vec(1, 2, 3), vec(1, 2, 3))).toBeCloseTo(1)
  })
  it('scores orthogonal vectors at 0', () => {
    expect(cosineSimilarity(vec(1, 0, 0), vec(0, 1, 0))).toBe(0)
  })
  it('scores opposite vectors at -1', () => {
    expect(cosineSimilarity(vec(1, 0, 0), vec(-1, 0, 0))).toBeCloseTo(-1)
  })
  it('returns 0 for a zero vector instead of NaN', () => {
    expect(cosineSimilarity(vec(0, 0, 0), vec(1, 1, 1))).toBe(0)
  })
})

// ─── 2. Clinical-PDF RAG — selectTopChunks ───────────────────────────────────

describe('Memory & RAG · PDF chunk retrieval', () => {
  const query = vec(1, 0, 0)
  const chunks = [
    chunk('exact', vec(1, 0, 0), 'glucose 110 mg/dl'),
    chunk('close', vec(0.8, 0.6, 0), 'ldl cholesterol slightly elevated'),
    chunk('weak', vec(0.3, 0.95, 0), 'unrelated paragraph'),
    chunk('off', vec(0, 1, 0), 'completely unrelated'),
  ]

  it('returns the highest-scoring chunk first', () => {
    const r = selectTopChunks(chunks, query, 4, 0.0)
    expect(r[0].text).toBe('glucose 110 mg/dl')
  })

  it('respects the top-k limit', () => {
    expect(selectTopChunks(chunks, query, 2, 0.0)).toHaveLength(2)
  })

  it('drops chunks below the similarity threshold', () => {
    // threshold 0.4 keeps 'exact' (1.0) and 'close' (0.8), drops the rest.
    const r = selectTopChunks(chunks, query, 10, 0.4)
    expect(r.map((c) => c.text)).toEqual(['glucose 110 mg/dl', 'ldl cholesterol slightly elevated'])
  })

  it('returns nothing when the embeddings model is unavailable (null query)', () => {
    expect(selectTopChunks(chunks, null, 4, 0.4)).toEqual([])
  })

  it('returns nothing when the member has no indexed chunks', () => {
    expect(selectTopChunks([], query, 4, 0.4)).toEqual([])
  })
})

// ─── 3. Durable-fact ranking — rankMemoriesByRelevance ───────────────────────

describe('Memory & RAG · durable-fact ranking · semantic', () => {
  it('surfaces a relevant OLD fact over 5 recent trivial ones', () => {
    // The query embedding points at the "what to avoid" axis (1,0,0).
    const query = vec(1, 0, 0)
    const memories: MemberMemory[] = [
      mem('allergic to shellfish', '2024-01-01T00:00:00Z', vec(0.95, 0.3, 0)),
      mem('likes oat milk', '2026-05-10T00:00:00Z', vec(0, 1, 0)),
      mem('cooks on weekends', '2026-05-11T00:00:00Z', vec(0, 0.9, 0.1)),
      mem('prefers cold breakfasts', '2026-05-12T00:00:00Z', vec(0, 0.8, 0.2)),
      mem('owns an air fryer', '2026-05-13T00:00:00Z', vec(0, 0.7, 0.3)),
      mem('drinks coffee black', '2026-05-14T00:00:00Z', vec(0, 0.6, 0.4)),
    ]
    const ranked = rankMemoriesByRelevance(memories, query, 'what should I avoid eating?', 3)
    // Pure recency would have dropped this fact entirely; relevance keeps it #1.
    expect(ranked[0].text).toBe('allergic to shellfish')
    expect(ranked).toHaveLength(3)
  })
})

describe('Memory & RAG · durable-fact ranking · lexical fallback', () => {
  it('ranks by keyword overlap when memories have no embedding', () => {
    const memories: MemberMemory[] = [
      mem('enjoys morning runs', '2026-05-12T00:00:00Z'),
      mem('avoids gluten and wheat', '2026-05-10T00:00:00Z'),
      mem('has two young children', '2026-05-14T00:00:00Z'),
    ]
    const ranked = rankMemoriesByRelevance(memories, null, 'gluten-free dinner ideas', 2)
    expect(ranked[0].text).toBe('avoids gluten and wheat')
  })

  it('falls back to keyword overlap per-memory when only the query is embedded', () => {
    // queryEmbedding present, but the memories predate migration 016 → no
    // embedding → the cosine branch is skipped per memory, keyword wins.
    const memories: MemberMemory[] = [
      mem('trains for marathons', '2026-05-12T00:00:00Z'),
      mem('intolerant to lactose', '2026-05-10T00:00:00Z'),
    ]
    const ranked = rankMemoriesByRelevance(memories, vec(1, 0, 0), 'is lactose a problem?', 1)
    expect(ranked[0].text).toBe('intolerant to lactose')
  })

  it('falls back to recency when the query carries no usable signal', () => {
    const memories: MemberMemory[] = [
      mem('fact one', '2026-01-01T00:00:00Z'),
      mem('fact two', '2026-03-01T00:00:00Z'),
      mem('fact three', '2026-05-01T00:00:00Z'),
    ]
    const ranked = rankMemoriesByRelevance(memories, null, '', 2)
    expect(ranked[0].text).toBe('fact three') // most recent
  })
})

describe('Memory & RAG · durable-fact ranking · bounds', () => {
  it('never returns more than k memories', () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      mem(`fact ${i}`, `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`)
    )
    expect(rankMemoriesByRelevance(memories, null, 'anything', 4)).toHaveLength(4)
  })
  it('returns an empty array for a member with no memories', () => {
    expect(rankMemoriesByRelevance([], vec(1, 0, 0), 'query', 5)).toEqual([])
  })
})
