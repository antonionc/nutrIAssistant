import { FamilyMember, SchoolMenuEntry } from '../../types/profiles'
import { MealPlan } from '../../types/planner'
import { getAge } from '../../utils/ageUtils'

// Minimal inventory shape accepted by prompt builders. The full InventoryItem
// type is a superset, so both callers (AI chat with full DB items, planner with
// a lightweight snapshot) satisfy this interface without type casts.
export interface InventoryLite {
  name: string
  quantity: number
  unit: string
  category?: string
  expiryDate?: string
}

// Maps known health conditions to concise nutritional guidance in Spanish.
const CONDITION_GUIDANCE: Record<string, string> = {
  hypertension: 'limitar sodio a menos de 1500mg/día, evitar alimentos procesados',
  osteoporosis: 'incluir alimentos ricos en calcio y vitamina D al menos una vez al día',
  diabetes_type1: 'controlar índice glucémico, limitar azúcares simples y carbohidratos refinados',
  diabetes_type2: 'controlar índice glucémico, limitar azúcares simples y carbohidratos refinados',
  celiac: 'evitar completamente el gluten (trigo, cebada, centeno)',
  lactose_intolerance: 'evitar lácteos o usar alternativas sin lactosa',
  high_cholesterol: 'limitar grasas saturadas, incluir fibra soluble (avena, legumbres)',
  ibs: 'evitar alimentos FODMAP altos, comidas grasas y picantes',
}

function buildConditionDirectives(profiles: FamilyMember[]): string {
  const lines: string[] = []
  for (const m of profiles) {
    for (const condition of m.conditions) {
      const guidance = CONDITION_GUIDANCE[condition]
      if (guidance) lines.push(`- ${m.name} (${condition}): ${guidance}`)
    }
  }
  return lines.join('\n')
}

function buildAllergenSummary(profiles: FamilyMember[]): string {
  return profiles
    .filter((m) => m.allergies.length > 0)
    .map((m) => `${m.name}=${m.allergies.join(',')}`)
    .join('; ')
}

export function buildCloudSystemPrompt(
  profiles: FamilyMember[],
  inventory: InventoryLite[],
  mealPlans?: MealPlan[],
  schoolMenuEntries?: SchoolMenuEntry[]
): string {
  const today = new Date().toISOString().split('T')[0]

  const profilesSummary = profiles.map((m) => ({
    id: m.id,
    name: m.name,
    role: m.role,
    age: getAge(m.dateOfBirth),
    weight: m.weight,
    height: m.height,
    allergies: m.allergies,
    conditions: m.conditions,
    dietPreference: m.dietPreference,
    dailyCalorieTarget: m.dailyCalorieTarget,
    macroTargets: m.macroTargets,
    supplements: m.supplements,
  }))

  const inventorySummary = inventory
    .filter((i) => i.quantity > 0)
    .map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      expiryDate: i.expiryDate,
      category: i.category,
    }))

  const mealPlanSummary = mealPlans?.slice(0, 7).map((p) => ({
    date: p.date,
    breakfast: (p.meals.breakfast as { name?: string } | undefined)?.name,
    lunch: (p.meals.lunch as { name?: string } | undefined)?.name,
    dinner: (p.meals.dinner as { name?: string } | undefined)?.name,
    isLocked: p.isLocked,
  }))

  const conditionDirectives = buildConditionDirectives(profiles)

  return `Eres NutriBot, el asistente experto en nutrición familiar de NutrIAssistant. La fecha de hoy es ${today}.

Responde SIEMPRE en español de España, de forma cercana y natural, como un amigo nutricionista.

PERFILES FAMILIARES:
${JSON.stringify(profilesSummary, null, 2)}

INVENTARIO DE DESPENSA ACTUAL:
${JSON.stringify(inventorySummary, null, 2)}

${mealPlanSummary ? `PLAN DE COMIDAS DE ESTA SEMANA:\n${JSON.stringify(mealPlanSummary, null, 2)}\n` : ''}
${schoolMenuEntries?.length ? `MENÚ ESCOLAR:\n${JSON.stringify(schoolMenuEntries, null, 2)}\n` : ''}

DIRECTRICES:
- Respetar SIEMPRE las alergias de todos los miembros de la familia
${conditionDirectives ? conditionDirectives + '\n' : ''}- Usar la dieta mediterránea como base
- En planes de comidas: no repetir la misma proteína principal más de 2 veces por semana
- Dar respuestas prácticas, concretas y adaptadas a la despensa disponible
- Si no hay ingredientes suficientes, sugerir qué comprar`
}

export function buildMealPlanGenerationPrompt(
  profiles: FamilyMember[],
  inventory: InventoryLite[],
  schoolMenuEntries?: SchoolMenuEntry[],
  startDate?: string
): string {
  const start = startDate ?? new Date().toISOString().split('T')[0]
  const allergenSummary = buildAllergenSummary(profiles)
  const conditionLines = buildConditionDirectives(profiles)
  const pantryItems = inventory
    .filter((i) => i.quantity > 0)
    .map((i) => `${i.name} (${i.quantity} ${i.unit})`)
    .join(', ')

  return `Generate a 7-day meal plan starting from ${start}.

Requirements:
- All meals must be safe for ALL family members${allergenSummary ? ` (allergies: ${allergenSummary})` : ''}
${pantryItems ? `- Use pantry ingredients when possible: ${pantryItems}` : '- No pantry items on hand; suggest what to buy'}
${conditionLines || ''}
- No protein source (chicken, beef, fish, legumes) repeated more than twice per week
- Mediterranean diet emphasis
- Variety in cuisines across the week

${schoolMenuEntries?.length ? `School menu context for this period:\n${JSON.stringify(schoolMenuEntries, null, 2)}\nLock school lunch days and plan breakfast/dinner to complement.` : ''}

Return ONLY a compact JSON array of 7 objects, no extra text:
[{"date":"YYYY-MM-DD","breakfast":{"name":"...","calories":0,"protein":0,"carbs":0,"fat":0},"lunch":{"name":"...","calories":0,"protein":0,"carbs":0,"fat":0},"dinner":{"name":"...","calories":0,"protein":0,"carbs":0,"fat":0}}]`
}
