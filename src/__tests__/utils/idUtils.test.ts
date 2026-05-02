import { generateId } from '../../utils/idUtils'

describe('generateId', () => {
  it('returns a string starting with the given prefix', () => {
    const id = generateId('msg')
    expect(id).toMatch(/^msg-/)
  })

  it('embeds a timestamp in the ID', () => {
    const before = Date.now()
    const id = generateId('x')
    const after = Date.now()
    const ts = parseInt(id.split('-')[1], 10)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('generates unique IDs even in rapid succession', () => {
    const ids = Array.from({ length: 1000 }, () => generateId('item'))
    const unique = new Set(ids)
    expect(unique.size).toBe(1000)
  })

  it('works with different prefixes', () => {
    expect(generateId('plan')).toMatch(/^plan-/)
    expect(generateId('recipe')).toMatch(/^recipe-/)
    expect(generateId('scan')).toMatch(/^scan-/)
  })
})
