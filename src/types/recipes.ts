import { NutritionalInfo, NutriScore } from './nutrition'

export type RecipeCategory = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'dessert'

export interface CompatibilityResult {
  memberId: string
  memberName: string
  isCompatible: boolean
  reason?: string
  riskLevel: 'safe' | 'warning' | 'danger'
}

export interface RecipeIngredient {
  name: string
  quantity: number
  unit: string
  fdcId?: string
  nutritionalInfo?: NutritionalInfo
  isAllergen: boolean
  allergenType?: string
}

export interface Recipe {
  id: string
  name: string
  nameEs?: string
  category: RecipeCategory
  cuisine: string
  cuisineFlag?: string
  instructions: string[]
  instructionsEs?: string[]
  ingredients: RecipeIngredient[]
  prepTime: number              // minutes
  cookTime: number              // minutes
  servings: number
  imageUrl?: string
  localImagePath?: string       // cached local path
  sourceApi?: 'fatsecret' | 'spoonacular' | 'themealdb' | 'ai_generated' | 'user_created'
  sourceId?: string
  nutritionalInfo: NutritionalInfo
  allergens: string[]
  tags: string[]
  familyCompatibility?: Record<string, CompatibilityResult>
  nutriscore?: NutriScore
  isFavorite?: boolean
  createdAt: string
  updatedAt: string
}
