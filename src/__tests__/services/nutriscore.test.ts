import { computeNutriScore } from '../../services/nutriscore'
import { NutritionalInfo } from '../../types/nutrition'

// All values are per 100g as required by the algorithm

describe('computeNutriScore', () => {
  it('returns A for a very healthy food (high protein, high fiber, low everything else)', () => {
    // score = (0+0+0+0) - (5+5) = -10 → A
    const n: NutritionalInfo = {
      calories: 150, protein: 20, carbs: 5, fat: 2,
      fiber: 5, sugar: 0, sodium: 50, saturatedFat: 0,
    }
    expect(computeNutriScore(n)).toBe('A')
  })

  it('returns B for a moderately healthy food', () => {
    // negative = 0+2+1+2 = 5; positive = 2+3 = 5; score = 0 → B
    const n: NutritionalInfo = {
      calories: 250, protein: 5, carbs: 30, fat: 10,
      fiber: 2, sugar: 8, sodium: 200, saturatedFat: 3,
    }
    expect(computeNutriScore(n)).toBe('B')
  })

  it('returns C for a moderately unhealthy food', () => {
    // negative = 1+4+3+3 = 11; positive = 1+3 = 4; score = 7 → C
    const n: NutritionalInfo = {
      calories: 400, protein: 5, carbs: 40, fat: 15,
      fiber: 1, sugar: 15, sodium: 300, saturatedFat: 5,
    }
    expect(computeNutriScore(n)).toBe('C')
  })

  it('returns D for an unhealthy food', () => {
    // negative = 1+7+5+5 = 18; positive = 0+3 = 3; score = 15 → D
    const n: NutritionalInfo = {
      calories: 600, protein: 5, carbs: 60, fat: 20,
      fiber: 0.5, sugar: 25, sodium: 500, saturatedFat: 8,
    }
    expect(computeNutriScore(n)).toBe('D')
  })

  it('returns E for a very unhealthy food', () => {
    // negative = 5+10+8+10 = 33; positive = 0+1 = 1; score = 32 → E
    const n: NutritionalInfo = {
      calories: 2000, protein: 3, carbs: 60, fat: 35,
      fiber: 0, sugar: 40, sodium: 1000, saturatedFat: 12,
    }
    expect(computeNutriScore(n)).toBe('E')
  })

  it('falls back to fat * 0.3 for saturated fat when saturatedFat is missing', () => {
    // fat=10 → saturatedFat estimate = 3g → satFatPoints(3) = 2
    const n: NutritionalInfo = {
      calories: 100, protein: 15, carbs: 5, fat: 10,
      fiber: 3, sugar: 2, sodium: 80,
    }
    expect(['A', 'B', 'C']).toContain(computeNutriScore(n))
  })

  it('handles all-zero nutrition without throwing', () => {
    const n: NutritionalInfo = { calories: 0, protein: 0, carbs: 0, fat: 0 }
    expect(() => computeNutriScore(n)).not.toThrow()
    expect(computeNutriScore(n)).toBe('B')
  })
})
