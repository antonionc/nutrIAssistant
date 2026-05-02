import { safeJsonParse } from '../../db/dbUtils'

describe('safeJsonParse', () => {
  beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { jest.restoreAllMocks() })

  it('parses a valid JSON object', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 })
  })

  it('parses a valid JSON array', () => {
    expect(safeJsonParse('["x","y"]', [])).toEqual(['x', 'y'])
  })

  it('returns the fallback for malformed JSON', () => {
    expect(safeJsonParse('{broken}', null)).toBe(null)
  })

  it('returns the fallback for an empty string', () => {
    expect(safeJsonParse('', [])).toEqual([])
  })

  it('returns the fallback for a non-string (number)', () => {
    expect(safeJsonParse(42, 'default')).toBe('default')
  })

  it('returns the fallback for null input', () => {
    expect(safeJsonParse(null, 'fallback')).toBe('fallback')
  })

  it('returns the fallback for undefined input', () => {
    expect(safeJsonParse(undefined, 99)).toBe(99)
  })

  it('preserves array fallback type when JSON is invalid', () => {
    const result = safeJsonParse('INVALID', [1, 2, 3])
    expect(result).toEqual([1, 2, 3])
  })
})
