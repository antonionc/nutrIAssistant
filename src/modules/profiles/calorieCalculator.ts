import { FamilyMember } from '../../types/profiles'
import { getAge } from '../../utils/ageUtils'

// Harris-Benedict Revised (Mifflin-St Jeor, 1990) for BMR
// Activity factor: sedentary (1.2) as default for family planning
function computeBMR(member: FamilyMember): number {
  const { weight, height, role } = member
  const age = getAge(member.dateOfBirth)
  const isMale = role === 'father' || role === 'son'

  if (isMale) {
    return 10 * weight + 6.25 * height - 5 * age + 5
  } else {
    return 10 * weight + 6.25 * height - 5 * age - 161
  }
}

export function computeDailyCalorieTarget(member: FamilyMember): number {
  const bmr = computeBMR(member)
  // Lightly active baseline for a family context
  return Math.round(bmr * 1.375)
}

export function computeMacroTargets(
  calories: number,
  conditions: string[]
): { protein: number; carbs: number; fat: number } {
  const hasHypertension = conditions.includes('hypertension')
  const hasOsteoporosis = conditions.includes('osteoporosis')

  // Default balanced macro split: 30P / 45C / 25F
  // Hypertension: lower sodium/fat emphasis → no macro change here (handled in recipe selection)
  // Osteoporosis: slightly higher protein
  let proteinPct = hasOsteoporosis ? 0.32 : 0.30
  let carbsPct = 0.45
  let fatPct = 1 - proteinPct - carbsPct

  const protein = Math.round((calories * proteinPct) / 4)  // 4 kcal/g
  const carbs = Math.round((calories * carbsPct) / 4)
  const fat = Math.round((calories * fatPct) / 9)  // 9 kcal/g

  return { protein, carbs, fat }
}
