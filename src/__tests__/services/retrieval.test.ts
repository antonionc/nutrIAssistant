import { rankByKeywordOverlap } from '../../services/retrieval'

describe('rankByKeywordOverlap', () => {
  const items = [
    { id: '1', name: 'tomate cherry' },
    { id: '2', name: 'lechuga romana' },
    { id: '3', name: 'pollo a la plancha' },
    { id: '4', name: 'aceite de oliva' },
    { id: '5', name: 'pasta integral' },
  ]

  it('returns top-K items by token overlap with the query', () => {
    const result = rankByKeywordOverlap(items, 'pollo con pasta', (i) => i.name, 2)
    const ids = result.map((r) => r.id)
    expect(ids).toEqual(expect.arrayContaining(['3', '5']))
    expect(ids.length).toBe(2)
  })

  it('handles accent-insensitive matching', () => {
    // "tomate" vs query without accent — both should normalise to "tomate"
    const result = rankByKeywordOverlap(items, 'añadir tomátes a la lista', (i) => i.name, 1)
    expect(result[0].id).toBe('1')
  })

  it('falls back to first items when no token matches, but never returns more than k', () => {
    const result = rankByKeywordOverlap(items, 'algo totalmente desconocido xyz', (i) => i.name, 3)
    expect(result.length).toBe(3)
  })

  it('returns up to k items even when fewer match', () => {
    // Single match — fillers should pad to k.
    const result = rankByKeywordOverlap(items, 'pollo', (i) => i.name, 3)
    expect(result.length).toBe(3)
    expect(result[0].id).toBe('3')
  })

  it('returns empty array when items is empty', () => {
    expect(rankByKeywordOverlap([], 'foo', (i: any) => i.name, 3)).toEqual([])
  })
})
