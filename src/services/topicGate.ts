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
  'azúcar', 'azucar', 'sodio', ' sal ', 'colesterol', 'vitamin', 'mineral',
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
  // Short beverage stems are word-boundary-anchored on BOTH sides: a bare
  // 'te ' would match "wri-te ", "chis-te ", "depor-te " and wrongly admit
  // off-topic queries. ' te ' (spaces both sides) only matches the word.
  'agua', 'beber', 'bebida', 'café', 'cafe', ' te ', 'infusión',
  'infusion', 'zumo', 'jugo', 'leche', 'alcohol', 'cerveza', 'vino',
  // Family-meal context (the assistant is family-aware)
  'familia', 'niño', 'niña', 'hij', 'famil', 'colegio', 'escuel',
  // Common foods (broad enough to catch "¿es bueno el aguacate?")
  'verdur', 'frut', 'carne', 'pescado', 'huevo', 'arroz', 'pasta', ' pan ',
  'queso', 'yogur', 'aceite', 'oliva', 'legumbr', 'lenteja', 'garbanz',
  'aguacat', 'tomate', 'plátano', 'manzana', 'pollo', 'ternera',
  // Cooking & exercise (adjacent enough — the assistant covers basic activity context)
  'ejercici', 'deport', 'entren',
]

const IN_SCOPE_STEMS_EN = [
  // Food / meals. ' eat' is anchored at the word start: a bare 'eat' would
  // match "w-eat-her", "gr-eat", "cr-eat-e" and wrongly admit off-topic
  // queries. The leading space still catches "eat / eating / eats / eaten".
  'food', 'meal', ' eat', 'breakfast', 'lunch', 'dinner', 'snack', 'dish',
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
  // Software / IT
  'javascript', 'typescript', 'python', 'java ', 'c++', 'react', 'componente',
  'función ', 'function ', 'código', 'codigo', 'programa', 'programar',
  'compilar', 'debuger', 'algoritmo', 'sql ', 'http', 'api ', 'json',
  'docker', 'kubernet', 'github', 'linux', 'navegador web', 'wifi',
  'bluetooth', 'contraseñ',
  // Politics / current affairs
  'político', 'politico', 'elecci', 'gobierno', 'presidente del gob',
  'partido políti', 'votar', 'trump', 'biden', 'putin', 'guerra en',
  // Sport
  'fútbol', 'futbol', 'champions', 'mundial', 'liga', 'tenis', 'fórmula 1',
  'formula 1', 'baloncesto', 'nba', 'la liga',
  // Finance
  'bolsa', 'invertir', 'cripto', 'bitcoin', 'ether', 'hipoteca', 'préstamo',
  'prestamo', 'nómina', 'declaración de la renta',
  // Entertainment / media. Stems (not full phrases) so paraphrases like
  // "cuéntame un chiste gracioso" / "¿sabes algún chiste?" / "hazme reír"
  // all match. Each stem is word-anchored where a shorter form would risk
  // colliding with food/health vocabulary (e.g. ' broma ' avoids matching
  // 'bromato', a food additive; ' rie' avoids matching 'arries-go').
  'película', 'pelicula', ' serie ', 'netflix', 'spotify', 'cantante',
  'cántame', 'cantame', 'cantar', 'canción', 'cancion',
  'videojuego', 'playstation', 'nintendo', 'tiktok',
  ' chist', ' chifl', ' broma ', ' bromas ', ' bromea',
  ' humor', ' gracios', 'divertid', 'entreten',
  ' rie ', ' ríe ', ' rio ', ' río ', ' risa', 'reír', ' reir ',
  'hazme reír', 'hazme reir', 'hacerme reír', 'hacerme reir',
  'cuéntame algo', 'cuentame algo',
  // Maths / homework
  'ecuación', 'ecuacion', 'derivada', 'álgebra', 'algebra', 'trigonometr',
  // Travel
  'vuelo a', 'reserva de hotel', 'vacacion', 'aeropuerto',
  // Misc off-topic
  'horóscopo', 'horoscopo', 'zodiac', 'tarot', 'mi coche', 'escribe un poema',
  'qué tiempo', 'qué hora', 'pronóstic', 'meteor',
]

const OUT_OF_SCOPE_STEMS_EN = [
  // Software / IT
  'javascript', 'typescript', 'python', ' java ', 'c++', 'react ',
  'component', 'function ', ' code ', 'algorithm', 'sql ', 'http', ' api ',
  'json', 'compile', 'debug', 'docker', 'kubernetes', 'github', 'linux',
  'wifi', 'bluetooth', 'password',
  // Politics / current affairs
  'politic', 'election', 'government', 'president', 'vote', 'trump',
  'biden', 'putin',
  // Sport
  'football', 'soccer', 'champions league', 'world cup', 'tennis',
  'formula 1', 'basketball', 'nba',
  // Finance
  'stock market', 'invest', 'crypto', 'bitcoin', 'ethereum', 'mortgage',
  'tax return', 'salary',
  // Entertainment / media. Stems instead of exact phrases so any
  // paraphrase ("a funny joke", "do you know any jokes", "make me laugh")
  // still classifies as off-topic. ' joke' is left-anchored to avoid
  // false hits inside unrelated words.
  'movie', 'tv show', 'netflix', 'spotify', 'singer', 'video game',
  'playstation', 'nintendo', 'tiktok',
  ' joke', ' jokes', 'funny', 'humor', 'humour', 'comedy', 'comedian',
  'entertain', ' amus', 'make me laugh', 'crack me up', 'tell me something funny',
  // Maths / homework
  'equation', 'derivative', 'algebra', 'trigonometry',
  // Travel
  'flight to', 'hotel booking', 'vacation', 'airport',
  // Misc off-topic
  'horoscope', 'zodiac', 'tarot', 'my car', 'write a poem',
  "what's the weather", 'weather forecast', 'what time is',
]

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    // Replace punctuation with spaces so word-anchored stems (e.g. ' broma ')
    // still match against "broma?" / "broma," — substring matching alone
    // would otherwise be defeated by trailing punctuation.
    .replace(/[?!.,;:¿¡"'`()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
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

// Stems every canned refusal (and the model parroting one) begins with.
// Locale-independent: a refusal may have been issued in either language.
const REFUSAL_PREFIXES = ['Soy NutriBot', "I'm NutriBot", 'Im NutriBot']

// True when `text` is one of NutriBot's canned topic-gate refusals. Used by
// the on-device AI eval harness to tell a hard refusal apart from a real
// generated answer.
export function isCannedRefusal(text: string): boolean {
  const trimmed = text.trim()
  return REFUSAL_PREFIXES.some((p) => trimmed.startsWith(p))
}

// Backwards-compat alias for callers that imported the constant before the
// localization refactor. New callers should use `getRefusalMessage()`.
export const REFUSAL_MESSAGE = REFUSAL_ES
