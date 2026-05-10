import { AllergenType } from '../types/profiles'

export const EU_14_ALLERGENS: AllergenType[] = [
  'gluten', 'dairy', 'eggs', 'peanuts', 'tree nuts', 'soy',
  'fish', 'shellfish', 'sesame', 'celery', 'mustard', 'lupin',
  'mollusks', 'sulfites',
]

// Display names live in src/i18n/{en,es}.ts under `allergens.*`. Render via
// `tr.allergens[a]` so labels follow the device locale.

// Cross-reactivity: if someone is allergic to X, also watch for Y
export const CROSS_REACTIVITY: Partial<Record<AllergenType, string[]>> = {
  peanuts: ['soy', 'lupin'],
  'tree nuts': ['peanuts'],
  dairy: ['goat milk', 'sheep milk'],
  shellfish: ['mollusks'],
}

// Ingredients that commonly contain each allergen
export const ALLERGEN_KEYWORDS: Record<AllergenType, string[]> = {
  gluten: ['wheat', 'flour', 'bread', 'pasta', 'barley', 'rye', 'oats', 'semolina', 'spelt'],
  dairy: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'lactose', 'whey', 'casein', 'parmesan', 'mozzarella', 'ricotta', 'brie', 'cheddar'],
  eggs: ['egg', 'eggs', 'albumin', 'mayonnaise', 'meringue'],
  peanuts: ['peanut', 'groundnut', 'monkey nut', 'arachis oil'],
  'tree nuts': ['almond', 'cashew', 'walnut', 'pistachio', 'pecan', 'hazelnut', 'macadamia', 'brazil nut', 'pine nut', 'chestnut'],
  soy: ['soy', 'soya', 'tofu', 'tempeh', 'edamame', 'miso', 'tamari'],
  fish: ['fish', 'salmon', 'tuna', 'cod', 'anchovy', 'sardine', 'bass', 'halibut', 'trout', 'mackerel', 'worcestershire'],
  shellfish: ['shrimp', 'prawn', 'crab', 'lobster', 'crayfish', 'langoustine'],
  sesame: ['sesame', 'tahini', 'sesame oil', 'sesame seed'],
  celery: ['celery', 'celeriac', 'celery seed', 'celery salt'],
  mustard: ['mustard', 'mustard seed', 'mustard oil', 'mustard leaves'],
  lupin: ['lupin', 'lupin flour', 'lupin seed'],
  mollusks: ['squid', 'octopus', 'scallop', 'clam', 'oyster', 'mussel', 'snail'],
  sulfites: ['sulphite', 'sulfite', 'sulphur dioxide', 'wine', 'dried fruit', 'vinegar'],
}
