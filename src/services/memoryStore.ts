import { getDatabase } from '../db/database'
import { generateId } from '../utils/idUtils'
import { encrypt, decrypt, encryptBytes, decryptBytes } from './encryption'
import { logger } from '../utils/logger'

// Persistence layer for the assistant's memory:
//   - member_memories: durable facts ("dislikes cilantro", "trains 3x/week")
//   - doc_chunks: PDF text chunks + embedding vectors for semantic retrieval
// All free-text columns are AES-GCM encrypted at rest. Embedding vectors are
// stored encrypted as well, since they leak content via inversion attacks.

export type MemoryCategory = 'preference' | 'health' | 'routine' | 'other'

export interface MemberMemory {
  id: string
  memberId: string
  text: string
  category: MemoryCategory
  createdAt: string
}

export interface DocChunkRow {
  id: string
  memberId: string
  docId: string
  chunkIndex: number
  text: string
  embedding: Float32Array
  createdAt: string
}

// ---------------- member_memories ----------------

export async function addMemberMemory(
  memberId: string,
  text: string,
  category: MemoryCategory
): Promise<MemberMemory> {
  const db = await getDatabase()
  const id = generateId('mem')
  const createdAt = new Date().toISOString()
  await db.runAsync(
    'INSERT INTO member_memories (id, member_id, encrypted_text, category, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, memberId, encrypt(text), category, createdAt]
  )
  return { id, memberId, text, category, createdAt }
}

export async function listMemberMemories(memberId: string): Promise<MemberMemory[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<{
    id: string
    member_id: string
    encrypted_text: string
    category: string
    created_at: string
  }>(
    'SELECT id, member_id, encrypted_text, category, created_at FROM member_memories WHERE member_id = ? ORDER BY created_at DESC',
    [memberId]
  )
  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id,
    text: safeDecrypt(r.encrypted_text),
    category: r.category as MemoryCategory,
    createdAt: r.created_at,
  })).filter((m) => m.text.length > 0)
}

// Most-recent-first, capped to k. Used by the prompt builder to inject ≤5
// memories without blowing the context budget.
export async function getTopMemoriesForMember(
  memberId: string,
  k: number
): Promise<MemberMemory[]> {
  const all = await listMemberMemories(memberId)
  return all.slice(0, k)
}

// Cheap COUNT(*) for UI badges/tiles. Avoids decrypting every row just to
// learn the size — encrypted columns are skipped entirely by the query.
export async function countMemberMemoriesForMember(memberId: string): Promise<number> {
  const db = await getDatabase()
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM member_memories WHERE member_id = ?',
    [memberId]
  )
  return row?.n ?? 0
}

export async function deleteMemberMemory(id: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM member_memories WHERE id = ?', [id])
}

export async function deleteAllMemoriesForMember(memberId: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM member_memories WHERE member_id = ?', [memberId])
}

// ---------------- doc_chunks ----------------

function float32ToUint8(arr: Float32Array): Uint8Array {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
}

function uint8ToFloat32(bytes: Uint8Array): Float32Array {
  // Copy into a fresh aligned buffer — SQLite may hand back a non-aligned
  // Uint8Array, which would make `new Float32Array(buffer)` throw.
  const aligned = new Uint8Array(bytes.length)
  aligned.set(bytes)
  return new Float32Array(aligned.buffer)
}

export async function insertDocChunk(
  memberId: string,
  docId: string,
  chunkIndex: number,
  text: string,
  embedding: Float32Array
): Promise<void> {
  const db = await getDatabase()
  const id = generateId('chk')
  const createdAt = new Date().toISOString()
  // Encrypted embedding stored as base64 (text column in BLOB position is fine
  // for SQLite — it just stores the bytes). We use a TEXT-typed insert via
  // base64 to keep all "encrypted" columns uniform.
  const encryptedEmbeddingB64 = encryptBytes(float32ToUint8(embedding))
  await db.runAsync(
    'INSERT INTO doc_chunks (id, member_id, doc_id, chunk_index, encrypted_text, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, memberId, docId, chunkIndex, encrypt(text), encryptedEmbeddingB64, createdAt]
  )
}

export async function getDocChunksForMember(memberId: string): Promise<DocChunkRow[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<{
    id: string
    member_id: string
    doc_id: string
    chunk_index: number
    encrypted_text: string
    embedding: string
    created_at: string
  }>(
    'SELECT id, member_id, doc_id, chunk_index, encrypted_text, embedding, created_at FROM doc_chunks WHERE member_id = ?',
    [memberId]
  )
  const out: DocChunkRow[] = []
  for (const r of rows) {
    try {
      const text = decrypt(r.encrypted_text)
      const embedding = uint8ToFloat32(decryptBytes(r.embedding))
      out.push({
        id: r.id,
        memberId: r.member_id,
        docId: r.doc_id,
        chunkIndex: r.chunk_index,
        text,
        embedding,
        createdAt: r.created_at,
      })
    } catch (e) {
      logger.warn('[memoryStore] dropping corrupt chunk', { id: r.id, err: e })
    }
  }
  return out
}

export async function deleteDocChunksForDoc(docId: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM doc_chunks WHERE doc_id = ?', [docId])
}

export async function deleteDocChunksForMember(memberId: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM doc_chunks WHERE member_id = ?', [memberId])
}

function safeDecrypt(blob: string): string {
  try {
    return decrypt(blob)
  } catch (e) {
    logger.warn('[memoryStore] decrypt failed (corrupt or wrong key)', e)
    return ''
  }
}
