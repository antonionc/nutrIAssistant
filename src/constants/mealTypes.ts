import { MealType } from '../types/planner'
import { t } from '../i18n'

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: t.nutrition.breakfast,
  lunch: t.nutrition.lunch,
  dinner: t.nutrition.dinner,
}

export const MEAL_EMOJIS: Record<MealType, string> = {
  breakfast: '🌅',
  lunch: '☀️',
  dinner: '🌙',
}
