export type GroceryCategory =
  | 'fruits_vegetables' | 'proteins' | 'dairy_alternatives' | 'grains_pantry' | 'other'

export interface GroceryItem {
  id: string
  name: string
  quantity: number
  unit: string
  category: GroceryCategory
  notes?: string
  isPurchased: boolean
  addedAt: string             // ISO date
  purchasedAt?: string
  fromMealPlan?: boolean
  recipeId?: string
}

export interface GroceryGroup {
  category: GroceryCategory
  label: string
  items: GroceryItem[]
}

export const GROCERY_CATEGORY_LABELS: Record<GroceryCategory, string> = {
  fruits_vegetables: 'Frutas y Verduras',
  proteins: 'Proteínas',
  dairy_alternatives: 'Lácteos y Alternativas',
  grains_pantry: 'Cereales y Despensa',
  other: 'Otros',
}
