// Single source of truth for domain catalogs used across the app.
// Importing from here (instead of from the services that originally
// declared each constant) prevents drift between e.g. the allergen
// list shown in the onboarding tags and the list checked by the
// allergen engine.
//
// Adding a new entry to any of these lists requires:
//   - matching i18n entries in `src/i18n/en.ts` AND `src/i18n/es.ts`
//   - (for allergens) keyword mappings in `src/seed/allergen-rules.ts`
//
// The coherence test at `src/__tests__/domain/masterData.test.ts`
// catches missing translations or missing keyword rules.

import { AllergenType, DietPreference } from '../types/profiles'

// ── Allergens ────────────────────────────────────────────────────────
// EU 14 official food allergens. Order is meaningful — it drives the
// rendering order in the onboarding tag grid and in the profile screen.
export const EU_14_ALLERGENS: AllergenType[] = [
  'gluten', 'dairy', 'eggs', 'peanuts', 'tree nuts', 'soy',
  'fish', 'shellfish', 'sesame', 'celery', 'mustard', 'lupin',
  'mollusks', 'sulfites',
]

// ── Conditions ───────────────────────────────────────────────────────
// User-declarable medical conditions. The values here are the IDs we
// persist; human-readable labels live in i18n (settings.conditions[id]).
export const CONDITIONS_LIST = [
  'hypertension', 'osteoporosis', 'diabetes_type1', 'diabetes_type2',
  'celiac', 'lactose_intolerance', 'high_cholesterol', 'ibs',
] as const

// ── Diet preferences ─────────────────────────────────────────────────
export const DIET_VALUES: DietPreference[] = [
  'none', 'mediterranean', 'vegetarian', 'vegan', 'pescatarian', 'keto',
]

// ── Cuisine catalogs ─────────────────────────────────────────────────
// The Edamam and Spoonacular providers expose different cuisine
// taxonomies. The Spoonacular set lives here so masterData is the SoT
// — `src/services/spoonacular.ts` re-exports it for back-compat. The
// Edamam set is internal to the Edamam service (driven by its
// `cuisineType` query parameter constraints).
export const SPOONACULAR_CUISINE_QUERIES: { cuisine: string; flag: string }[] = [
  { cuisine: 'mediterranean', flag: '🌊' },
  { cuisine: 'italian',       flag: '🇮🇹' },
  { cuisine: 'spanish',       flag: '🇪🇸' },
  { cuisine: 'greek',         flag: '🇬🇷' },
  { cuisine: 'french',        flag: '🇫🇷' },
  { cuisine: 'moroccan',      flag: '🇲🇦' },
  { cuisine: 'turkish',       flag: '🇹🇷' },
  { cuisine: 'japanese',      flag: '🇯🇵' },
  { cuisine: 'mexican',       flag: '🇲🇽' },
  { cuisine: 'indian',        flag: '🇮🇳' },
  { cuisine: 'chinese',       flag: '🇨🇳' },
  { cuisine: 'thai',          flag: '🇹🇭' },
  { cuisine: 'korean',        flag: '🇰🇷' },
  { cuisine: 'american',      flag: '🇺🇸' },
  { cuisine: 'middle eastern',flag: '🌙' },
  { cuisine: 'caribbean',     flag: '🏝️' },
  { cuisine: 'vietnamese',    flag: '🇻🇳' },
  { cuisine: 'german',        flag: '🇩🇪' },
  { cuisine: 'latin american',flag: '🌎' },
  { cuisine: 'african',       flag: '🌍' },
]
