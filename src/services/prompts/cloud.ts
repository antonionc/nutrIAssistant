import { FamilyMember } from '../../types/profiles'
import { InventoryItem } from '../../types/inventory'
import { MealPlan } from '../../types/planner'
import { SchoolMenuEntry } from '../../types/profiles'
import { getAge } from '../../utils/ageUtils'

export function buildCloudSystemPrompt(
  profiles: FamilyMember[],
  inventory: InventoryItem[],
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
- Harry tiene hipertensión: limitar sodio a menos de 1500mg/día, evitar alimentos procesados
- Ginny tiene osteoporosis: incluir alimentos ricos en calcio y vitamina D
- Usar la dieta mediterránea como base
- En planes de comidas: no repetir la misma proteína principal más de 2 veces por semana
- Dar respuestas prácticas, concretas y adaptadas a la despensa disponible
- Si no hay ingredientes suficientes, sugerir qué comprar`
}

export function buildMealPlanGenerationPrompt(
  profiles: FamilyMember[],
  inventory: InventoryItem[],
  schoolMenuEntries?: SchoolMenuEntry[],
  startDate?: string
): string {
  const start = startDate ?? new Date().toISOString().split('T')[0]

  return `Generate a 7-day meal plan starting from ${start} for the Potter family.

Requirements:
- All meals must be safe for ALL family members (respect allergies: Ginny=peanuts, James=tree nuts, Lily=dairy)
- Use ingredients from the pantry when possible
- Harry (hypertension): keep sodium < 1500mg/day, no processed foods
- Ginny (osteoporosis): include calcium-rich foods at least once per day
- No protein source (chicken, beef, fish, legumes) repeated more than twice per week
- Mediterranean diet emphasis
- Variety in cuisines across the week
- Each meal should include: recipe name, brief description, estimated macros, key allergen warnings

${schoolMenuEntries?.length ? `School menu context for this period:\n${JSON.stringify(schoolMenuEntries, null, 2)}\nLock school lunch days and plan breakfast/dinner to complement.` : ''}

Return ONLY a compact JSON array of 7 objects, no extra text:
[{"date":"YYYY-MM-DD","breakfast":{"name":"...","calories":0,"protein":0,"carbs":0,"fat":0},"lunch":{"name":"...","calories":0,"protein":0,"carbs":0,"fat":0},"dinner":{"name":"...","calories":0,"protein":0,"carbs":0,"fat":0}}]`
}
