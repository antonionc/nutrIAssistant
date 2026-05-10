import { currentLang } from '../utils/locale'
// currentLang is still used by getRefusalMessage below.

// Lightweight pre-classifier so the on-device LLM only ever sees questions
// in NutriBot's domain (nutrition, food, health, meals, groceries). Saves a
// full ~1B-model inference for obvious off-topic queries and prevents the
// assistant from straying outside scope.
//
// Strategy: cheap keyword lookup, three-way verdict.
//   - 'in'        → at least one in-scope keyword matched
//   - 'out'       → at least one off-scope marker matched AND no in-scope keyword
//   - 'ambiguous' → neither matched; let the LLM handle with its directive

// Matching uses partial-word stems (e.g. "nutri" catches "nutrición",
// "nutritional", "nutrientes"). All comparisons are accent-insensitive and
// lower-cased so users don't need to write "Á" vs "á" precisely.
const IN_SCOPE_STEMS_ES = [
  // Food / meals
  'comid', 'comer', 'aliment', 'desayun', 'almuerz', 'cena', 'merien', 'snack',
  'plato', 'menu', 'menú', 'receta', 'ingredient', 'cocin', 'cociné', 'hornea',
  // Nutrition
  'nutri', 'calor', 'kcal', 'proteín', 'protein', 'carbohidr', 'grasa', 'fibra',
  'azúcar', 'azucar', 'sodio', 'sal ', 'colesterol', 'vitamin', 'mineral',
  'hidrat', 'hierr', 'calci', 'omega', 'antioxid',
  // Diet patterns
  'dieta', 'diet', 'mediterrane', 'mediterráne', 'vegan', 'vegetarian',
  'pescetarian', 'pescatarian', 'keto', 'paleo', 'ayuno',
  // Allergies & conditions
  'alergi', 'alérg', 'intoler', 'gluten', 'lácte', 'lacte', 'sin lactosa',
  'celíac', 'celiac', 'diabet', 'hiperten', 'tensión', 'tension', 'IBS',
  'colon irritab', 'tiroid', 'osteoporos', 'anemi',
  // Health / labs
  'salud', 'médic', 'medic', 'lab', 'análisis', 'analisis', 'sangre',
  'presión', 'presion', 'peso', 'IMC', 'glucos', 'colester', 'tiroide',
  // Groceries / shopping
  'compra', 'comprar', 'lista', 'supermerc', 'mercad', 'despens', 'nevera',
  'frigorífic', 'frigorific', 'caduc',
  // Beverages
  'agua', 'beber', 'bebida', 'café', 'cafe', 'té ', ' te ', 'infusión',
  'infusion', 'zumo', 'jugo', 'leche', 'alcohol', 'cerveza', 'vino',
  // Family-meal context (the assistant is family-aware)
  'familia', 'niño', 'niña', 'hij', 'famil', 'colegio', 'escuel',
  // Common foods (broad enough to catch "¿es bueno el aguacate?")
  'verdur', 'frut', 'carne', 'pescado', 'huevo', 'arroz', 'pasta', 'pan ',
  'queso', 'yogur', 'aceite', 'oliva', 'legumbr', 'lenteja', 'garbanz',
  'aguacat', 'tomate', 'plátano', 'manzana', 'pollo', 'ternera',
  // Cooking & exercise (adjacent enough — the assistant covers basic activity context)
  'ejercici', 'deport', 'entren',
]

const IN_SCOPE_STEMS_EN = [
  // Food / meals
  'food', 'meal', 'eat', 'breakfast', 'lunch', 'dinner', 'snack', 'dish',
  'menu', 'recipe', 'ingredient', 'cook', 'bake', 'roast', 'fry', 'grill',
  // Nutrition
  'nutri', 'calor', 'kcal', 'protein', 'carb', 'fat ', 'fiber', 'sugar',
  'sodium', 'cholesterol', 'vitamin', 'mineral', 'iron', 'calcium', 'omega',
  'antioxid',
  // Diet patterns
  'diet', 'mediterranean', 'vegan', 'vegetarian', 'pescatarian', 'keto',
  'paleo', 'fasting',
  // Allergies & conditions
  'allerg', 'intoler', 'gluten', 'dairy', 'lactose', 'celiac', 'coeliac',
  'diabet', 'hypertens', 'blood pressure', 'ibs', 'irritable bowel',
  'thyroid', 'osteoporos', 'anaemia', 'anemia',
  // Health / labs
  'health', 'medic', 'lab ', 'lab work', 'lab results', 'blood test',
  'weight', 'bmi', 'glucose',
  // Groceries / shopping
  'grocer', 'shop', 'shopping', 'list', 'pantry', 'fridge', 'freezer',
  'supermarket', 'expir',
  // Beverages
  'water', 'drink', 'coffee', 'tea ', 'juice', 'milk', 'alcohol', 'beer',
  'wine',
  // Family / school
  'family', 'kid', 'child', 'school',
  // Common foods
  'veget', 'fruit', 'meat', 'fish', 'egg', 'rice', 'pasta', 'bread',
  'cheese', 'yogurt', 'olive oil', 'legume', 'lentil', 'chickpea',
  'avocado', 'tomato', 'banana', 'apple', 'chicken', 'beef',
  // Cooking & exercise
  'exercise', 'workout', 'sport', 'training',
]

const OUT_OF_SCOPE_STEMS_ES = [
  'javascript', 'typescript', 'python', 'java ', 'c++', 'react', 'componente',
  'función ', 'function ', 'código', 'codigo', 'programa', 'programar',
  'compilar', 'debuger', 'algoritmo', 'sql ', 'http', 'api ', 'json',
  'político', 'politico', 'elecci', 'gobierno', 'presidente del gob',
  'partido políti', 'votar', 'trump', 'biden', 'putin', 'guerra en',
  'fútbol', 'futbol', 'champions', 'mundial', 'liga', 'tenis', 'fórmula 1',
  'formula 1', 'baloncesto', 'nba', 'la liga',
  'bolsa', 'invertir', 'cripto', 'bitcoin', 'ether',
  'película', 'pelicula', 'serie de tv', 'netflix', 'spotify', 'cantante',
  'qué tiempo', 'qué hora', 'pronóstic', 'meteor',
]

const OUT_OF_SCOPE_STEMS_EN = [
  'javascript', 'typescript', 'python', ' java ', 'c++', 'react ',
  'component', 'function ', ' code ', 'algorithm', 'sql ', 'http', ' api ',
  'json', 'compile', 'debug',
  'politic', 'election', 'government', 'president', 'vote', 'trump',
  'biden', 'putin',
  'football', 'soccer', 'champions league', 'world cup', 'tennis',
  'formula 1', 'basketball', 'nba',
  'stock market', 'invest', 'crypto', 'bitcoin', 'ethereum',
  'movie', 'tv show', 'netflix', 'spotify', 'singer',
  "what's the weather", 'weather forecast', 'what time is',
]

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
}

function stemMatches(haystack: string, stems: string[]): boolean {
  for (const stem of stems) {
    const norm = normalize(stem)
    if (haystack.includes(norm)) return true
  }
  return false
}

export type TopicVerdict = 'in' | 'out' | 'ambiguous'

export function classify(query: string): TopicVerdict {
  const text = ' ' + normalize(query) + ' '
  // Off-topic / on-topic content is independent of the UI language —
  // "fútbol" is sports whether the user types in EN or ES. Always union
  // both locales' stem sets so a Spanish query on an English device (or
  // vice-versa) still gets the right verdict.
  const inMatch = stemMatches(text, IN_SCOPE_STEMS_ES) || stemMatches(text, IN_SCOPE_STEMS_EN)
  if (inMatch) return 'in'
  const outMatch =
    stemMatches(text, OUT_OF_SCOPE_STEMS_ES) || stemMatches(text, OUT_OF_SCOPE_STEMS_EN)
  if (outMatch) return 'out'
  return 'ambiguous'
}

// Canned refusal returned when classify === 'out'. Localized so the user
// always sees their UI language. Kept short, friendly, redirects to scope.
const REFUSAL_ES =
  'Soy NutriBot, así que solo puedo ayudarte con nutrición, alimentación, salud, comidas y compras. ¿Hay algo de eso en lo que te pueda echar una mano?'
const REFUSAL_EN =
  "I'm NutriBot, so I can only help with nutrition, food, health, meals and groceries. Is there anything in that area I can help you with?"

export function getRefusalMessage(): string {
  return currentLang() === 'en' ? REFUSAL_EN : REFUSAL_ES
}

// Backwards-compat alias for callers that imported the constant before the
// localization refactor. New callers should use `getRefusalMessage()`.
export const REFUSAL_MESSAGE = REFUSAL_ES
