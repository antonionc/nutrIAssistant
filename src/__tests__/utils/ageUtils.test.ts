import { getAge } from '../../utils/ageUtils'

// Pin "today" to a fixed date so tests never flake on real calendar boundaries
const FIXED_TODAY = new Date('2026-05-02T12:00:00.000Z')

beforeAll(() => {
  jest.useFakeTimers()
  jest.setSystemTime(FIXED_TODAY)
})

afterAll(() => {
  jest.useRealTimers()
})

describe('getAge', () => {
  it('calculates correct age when birthday has already passed this year', () => {
    // Born 1990-01-15: by May 2026 their birthday (Jan 15) has passed → age 36
    expect(getAge('1990-01-15')).toBe(36)
  })

  it('calculates correct age when birthday has not yet occurred this year', () => {
    // Born 1990-12-01: by May 2026 their birthday (Dec 1) has not yet passed → age 35
    expect(getAge('1990-12-01')).toBe(35)
  })

  it('returns correct age on exact birthday', () => {
    // Born 2000-05-02: today is May 2 2026 → birthday is today → age 26
    expect(getAge('2000-05-02')).toBe(26)
  })

  it('returns 0 for a newborn (born today)', () => {
    expect(getAge('2026-05-02')).toBe(0)
  })

  it('returns 0 for an invalid date string', () => {
    expect(getAge('not-a-date')).toBe(0)
  })

  it('returns 0 for an empty string', () => {
    expect(getAge('')).toBe(0)
  })

  it('handles age for a child born last year', () => {
    // Born 2025-03-10: in May 2026 birthday (Mar 10) has passed → age 1
    expect(getAge('2025-03-10')).toBe(1)
  })
})
