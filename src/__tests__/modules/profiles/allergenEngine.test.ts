import {
  checkMemberCompatibility,
  checkFamilyCompatibility,
  detectAllergensInIngredients,
} from '../../../modules/profiles/allergenEngine'
import { FamilyMember } from '../../../types/profiles'

const baseMember = (overrides: Partial<FamilyMember> = {}): FamilyMember => ({
  id: 'm1',
  name: 'Test Member',
  role: 'other',
  dateOfBirth: '1990-01-01',
  weight: 70,
  height: 170,
  allergies: [],
  conditions: [],
  dietPreference: 'none',
  isSchoolAge: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('checkMemberCompatibility', () => {
  it('returns safe for a member with no allergies', () => {
    const result = checkMemberCompatibility(['wheat', 'peanut butter'], baseMember())
    expect(result.isCompatible).toBe(true)
    expect(result.riskLevel).toBe('safe')
  })

  it('returns danger when an ingredient directly contains the allergen', () => {
    const member = baseMember({ allergies: ['peanuts'] })
    const result = checkMemberCompatibility(['peanut oil', 'garlic'], member)
    expect(result.isCompatible).toBe(false)
    expect(result.riskLevel).toBe('danger')
    expect(result.reason).toMatch(/peanuts/i)
  })

  it('returns safe when no ingredients match the allergen', () => {
    const member = baseMember({ allergies: ['peanuts'] })
    const result = checkMemberCompatibility(['chicken', 'olive oil', 'garlic'], member)
    expect(result.isCompatible).toBe(true)
    expect(result.riskLevel).toBe('safe')
  })

  it('returns warning for cross-reactive ingredients (peanut allergy + soy)', () => {
    const member = baseMember({ allergies: ['peanuts'] })
    // soy is cross-reactive with peanuts per CROSS_REACTIVITY
    const result = checkMemberCompatibility(['soy sauce', 'garlic'], member)
    expect(result.riskLevel).toBe('warning')
    expect(result.isCompatible).toBe(false)
  })

  it('returns warning (but compatible) for hypertension + high-sodium ingredient', () => {
    // member needs at least one allergy so the allergen loop runs and reaches the condition check
    // eggs has no cross-reactivity with soy, so only the hypertension check fires
    const member = baseMember({ conditions: ['hypertension'], allergies: ['eggs'] })
    const result = checkMemberCompatibility(['soy sauce', 'rice'], member)
    expect(result.isCompatible).toBe(true)
    expect(result.riskLevel).toBe('warning')
  })

  it('includes the member name in the result', () => {
    const member = baseMember({ name: 'Elena', allergies: ['dairy'] })
    const result = checkMemberCompatibility(['butter', 'flour'], member)
    expect(result.memberName).toBe('Elena')
  })

  it('detects gluten allergy in wheat-based ingredient', () => {
    const member = baseMember({ allergies: ['gluten'] })
    const result = checkMemberCompatibility(['wheat flour', 'sugar'], member)
    expect(result.isCompatible).toBe(false)
    expect(result.riskLevel).toBe('danger')
  })

  it('detects dairy allergy in milk-based ingredient', () => {
    const member = baseMember({ allergies: ['dairy'] })
    const result = checkMemberCompatibility(['parmesan cheese', 'olive oil'], member)
    expect(result.isCompatible).toBe(false)
  })
})

describe('checkFamilyCompatibility', () => {
  it('returns a result entry for every family member', () => {
    const profiles = [
      baseMember({ id: 'a', name: 'A' }),
      baseMember({ id: 'b', name: 'B', allergies: ['eggs'] }),
    ]
    const recipe = { ingredients: [{ name: 'egg', quantity: 2, unit: 'pcs' }], allergens: [] }
    const result = checkFamilyCompatibility(recipe, profiles)
    expect(Object.keys(result)).toHaveLength(2)
    expect(result['a'].isCompatible).toBe(true)
    expect(result['b'].isCompatible).toBe(false)
  })

  it('returns empty object for empty profiles', () => {
    const recipe = { ingredients: [{ name: 'chicken', quantity: 1, unit: 'kg' }], allergens: [] }
    expect(checkFamilyCompatibility(recipe, [])).toEqual({})
  })

  it('includes allergens from the allergens array, not just ingredients', () => {
    const member = baseMember({ id: 'x', allergies: ['fish'] })
    // allergen listed in recipe.allergens but not in ingredient names
    const recipe = {
      ingredients: [{ name: 'worcestershire sauce', quantity: 1, unit: 'tbsp' }],
      allergens: ['fish'],
    }
    const result = checkFamilyCompatibility(recipe, [member])
    expect(result['x'].isCompatible).toBe(false)
  })
})

describe('detectAllergensInIngredients', () => {
  it('detects gluten from wheat flour', () => {
    const found = detectAllergensInIngredients(['wheat flour', 'sugar', 'water'])
    expect(found).toContain('gluten')
  })

  it('detects dairy from milk', () => {
    const found = detectAllergensInIngredients(['milk', 'honey'])
    expect(found).toContain('dairy')
  })

  it('detects multiple allergens at once', () => {
    const found = detectAllergensInIngredients(['wheat pasta', 'eggs', 'parmesan'])
    expect(found).toContain('gluten')
    expect(found).toContain('eggs')
    expect(found).toContain('dairy')
  })

  it('returns empty array when no allergens are present', () => {
    const found = detectAllergensInIngredients(['chicken breast', 'olive oil', 'garlic', 'lemon'])
    expect(found).toHaveLength(0)
  })

  it('is case-insensitive', () => {
    const found = detectAllergensInIngredients(['WHEAT FLOUR', 'Eggs'])
    expect(found).toContain('gluten')
    expect(found).toContain('eggs')
  })
})
