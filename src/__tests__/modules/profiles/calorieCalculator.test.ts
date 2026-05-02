import { computeDailyCalorieTarget, computeMacroTargets } from '../../../modules/profiles/calorieCalculator'
import { getAge } from '../../../utils/ageUtils'
import { FamilyMember } from '../../../types/profiles'

const FIXED_TODAY = new Date('2026-05-02T12:00:00.000Z')
beforeAll(() => {
  jest.useFakeTimers()
  jest.setSystemTime(FIXED_TODAY)
})
afterAll(() => { jest.useRealTimers() })

const makeMember = (overrides: Partial<FamilyMember> = {}): FamilyMember => ({
  id: 'm1',
  name: 'Test',
  role: 'father',
  dateOfBirth: '1990-01-01',  // age 36 by May 2026
  weight: 80,
  height: 180,
  allergies: [],
  conditions: [],
  dietPreference: 'none',
  isSchoolAge: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('computeDailyCalorieTarget', () => {
  it('correctly applies Mifflin-St Jeor formula for a male', () => {
    const member = makeMember({ role: 'father', dateOfBirth: '1990-01-01', weight: 80, height: 180 })
    const age = getAge(member.dateOfBirth)    // 36
    const expectedBMR = 10 * 80 + 6.25 * 180 - 5 * age + 5
    const expected = Math.round(expectedBMR * 1.375)
    expect(computeDailyCalorieTarget(member)).toBe(expected)
  })

  it('correctly applies Mifflin-St Jeor formula for a female', () => {
    const member = makeMember({ role: 'mother', dateOfBirth: '1990-01-01', weight: 65, height: 165 })
    const age = getAge(member.dateOfBirth)
    const expectedBMR = 10 * 65 + 6.25 * 165 - 5 * age - 161
    const expected = Math.round(expectedBMR * 1.375)
    expect(computeDailyCalorieTarget(member)).toBe(expected)
  })

  it('returns a higher calorie target for a male than a female of the same stats', () => {
    const base = { dateOfBirth: '1990-01-01', weight: 70, height: 175 }
    const male = computeDailyCalorieTarget(makeMember({ role: 'father', ...base }))
    const female = computeDailyCalorieTarget(makeMember({ role: 'mother', ...base }))
    expect(male).toBeGreaterThan(female)
  })

  it('treats son as male and daughter as female', () => {
    const base = { dateOfBirth: '2010-01-01', weight: 50, height: 160 }
    const son = computeDailyCalorieTarget(makeMember({ role: 'son', ...base }))
    const daughter = computeDailyCalorieTarget(makeMember({ role: 'daughter', ...base }))
    expect(son).toBeGreaterThan(daughter)
  })
})

describe('computeMacroTargets', () => {
  it('protein * 4 + carbs * 4 + fat * 9 is approximately equal to input calories', () => {
    const { protein, carbs, fat } = computeMacroTargets(2000, [])
    const totalKcal = protein * 4 + carbs * 4 + fat * 9
    // Allow ±50 kcal tolerance for rounding
    expect(totalKcal).toBeGreaterThan(1950)
    expect(totalKcal).toBeLessThan(2050)
  })

  it('uses a 30/45/25 split by default (no conditions)', () => {
    const { protein, carbs, fat } = computeMacroTargets(2000, [])
    expect(protein).toBe(150)  // round(2000 * 0.30 / 4)
    expect(carbs).toBe(225)    // round(2000 * 0.45 / 4)
    expect(fat).toBe(56)       // round(2000 * 0.25 / 9)
  })

  it('increases protein percentage for osteoporosis', () => {
    const healthy = computeMacroTargets(2000, [])
    const osteoporosis = computeMacroTargets(2000, ['osteoporosis'])
    expect(osteoporosis.protein).toBeGreaterThan(healthy.protein)
  })

  it('does not change macros for hypertension (handled via recipe selection)', () => {
    const healthy = computeMacroTargets(2000, [])
    const hypertension = computeMacroTargets(2000, ['hypertension'])
    // Hypertension has no macro effect — same split
    expect(hypertension).toEqual(healthy)
  })

  it('scales proportionally with calorie input', () => {
    const a = computeMacroTargets(1000, [])
    const b = computeMacroTargets(2000, [])
    expect(b.protein).toBe(a.protein * 2)
    // carbs uses Math.round which is non-linear; verify it roughly doubles instead
    expect(b.carbs).toBeGreaterThan(a.carbs * 1.9)
    expect(b.carbs).toBeLessThan(a.carbs * 2.1)
  })
})
