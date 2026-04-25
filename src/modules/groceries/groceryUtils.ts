import { GroceryCategory } from '../../types/groceries'

export function inferGroceryCategory(name: string): GroceryCategory {
  const lower = name.toLowerCase()
  const fruitVeg = ['tomato', 'onion', 'garlic', 'carrot', 'spinach', 'broccoli', 'pepper', 'lettuce', 'cucumber', 'zucchini', 'eggplant', 'apple', 'banana', 'orange', 'lemon', 'strawberry', 'grape', 'peach', 'pear', 'potato', 'mushroom', 'avocado']
  const proteins = ['chicken', 'beef', 'pork', 'fish', 'salmon', 'tuna', 'shrimp', 'turkey', 'egg', 'lentil', 'chickpea', 'bean', 'tofu']
  const dairy = ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'mozzarella', 'parmesan']
  const grains = ['bread', 'pasta', 'rice', 'flour', 'oat', 'cereal', 'cracker', 'tortilla', 'quinoa', 'barley']

  if (fruitVeg.some((kw) => lower.includes(kw))) return 'fruits_vegetables'
  if (proteins.some((kw) => lower.includes(kw))) return 'proteins'
  if (dairy.some((kw) => lower.includes(kw))) return 'dairy_alternatives'
  if (grains.some((kw) => lower.includes(kw))) return 'grains_pantry'
  return 'other'
}
