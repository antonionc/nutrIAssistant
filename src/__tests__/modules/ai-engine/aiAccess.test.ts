import { isAIAccessibleForMember, ADULT_AGE } from '../../../modules/ai-engine/aiAccess'
import { FamilyMember } from '../../../types/profiles'

// Build a year-MM-DD string for someone whose age, today, will be `ageYears`.
// Subtracts one extra day so the birthday is guaranteed to have passed.
function dobForAge(ageYears: number): string {
  const today = new Date()
  const dob = new Date(today)
  dob.setFullYear(today.getFullYear() - ageYears)
  dob.setDate(dob.getDate() - 1)
  return dob.toISOString().split('T')[0]
}

const baseMember = (overrides: Partial<FamilyMember> = {}): FamilyMember => ({
  id: 'mem-x',
  name: 'Test',
  role: 'father',
  dateOfBirth: dobForAge(40),
  weight: 0,
  height: 0,
  allergies: [],
  conditions: [],
  dietPreference: 'none',
  isSchoolAge: false,
  favoriteRecipeIds: [],
  documents: [],
  isSuperUser: false,
  createdAt: '',
  updatedAt: '',
  ...overrides,
})

describe('isAIAccessibleForMember (age gate for AI assistant)', () => {
  it('allows a typical adult member', () => {
    expect(isAIAccessibleForMember(baseMember({ dateOfBirth: dobForAge(35) }))).toBe(true)
  })

  it('blocks a member who is 17 (minor)', () => {
    expect(isAIAccessibleForMember(baseMember({ dateOfBirth: dobForAge(17) }))).toBe(false)
  })

  it('allows a member who is exactly 18 (boundary)', () => {
    expect(isAIAccessibleForMember(baseMember({ dateOfBirth: dobForAge(18) }))).toBe(true)
  })

  it('allows a member who is 19', () => {
    expect(isAIAccessibleForMember(baseMember({ dateOfBirth: dobForAge(19) }))).toBe(true)
  })

  it('blocks a member who is 0 (newborn)', () => {
    expect(isAIAccessibleForMember(baseMember({ dateOfBirth: dobForAge(0) }))).toBe(false)
  })

  it('blocks when no member is provided (null)', () => {
    expect(isAIAccessibleForMember(null)).toBe(false)
  })

  it('blocks when no member is provided (undefined)', () => {
    expect(isAIAccessibleForMember(undefined)).toBe(false)
  })

  it('blocks when dateOfBirth is empty string', () => {
    // Cast: the type requires dateOfBirth, but legacy/corrupt data can omit it.
    expect(isAIAccessibleForMember(baseMember({ dateOfBirth: '' as unknown as string }))).toBe(false)
  })

  it('blocks when dateOfBirth is malformed', () => {
    // getAge returns 0 for unparseable input, so the policy denies.
    expect(isAIAccessibleForMember(baseMember({ dateOfBirth: 'not-a-date' }))).toBe(false)
  })

  it('blocks a member born one day from now (treated as age 0 → minor)', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(
      isAIAccessibleForMember(
        baseMember({ dateOfBirth: tomorrow.toISOString().split('T')[0] })
      )
    ).toBe(false)
  })

  it('exposes ADULT_AGE = 18 (sanity check the published constant)', () => {
    expect(ADULT_AGE).toBe(18)
  })
})
