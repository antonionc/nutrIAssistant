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

// Single source of truth for the on-device LLM system prompt. Compact,
// line-based layout (NOT JSON) — the executorch Llama 3.2 1B mobile build
// has a ~2k context window, so JSON dumps of the full family payload
// overflow it and trigger a generic "Failed to generate text" native error.
const INVENTORY_PROMPT_LIMIT = 30
const FAVORITES_PER_MEMBER = 5
const DOCS_PER_MEMBER = 3
const DOC_SUMMARY_MAX_CHARS = 200
const RECIPES_AVAILABLE_LIMIT = 20

export interface RecipeRef {
  id: string
  name: string
}

export interface PromptExtras {
  // Map of recipe id → name. Used to resolve favorite names per member and
  // to surface a candidate ID list to the LLM for the <actions> protocol.
  recipeIndex?: Map<string, string>
  // Top recipes the LLM may reference by id in <actions>.
  availableRecipes?: RecipeRef[]
  // Family member currently using the app. The LLM should address them
  // directly and prioritise their constraints, while still seeing the rest
  // of the family for cross-member queries.
  activeMemberId?: string
}

export function buildSystemPrompt(
  profiles: FamilyMember[],
  inventory: InventoryLite[],
  mealPlans?: MealPlan[],
  schoolMenuEntries?: SchoolMenuEntry[],
  extras?: PromptExtras
): string {
  const today = new Date().toISOString().split('T')[0]
  const recipeIndex = extras?.recipeIndex

  const profileLines = profiles
    .map((m) => {
      const parts: string[] = [`id=${m.id}; ${m.name} (${m.role}, ${getAge(m.dateOfBirth)}a)`]
      if (m.dietPreference && m.dietPreference !== 'none') parts.push(`dieta=${m.dietPreference}`)
      if (m.allergies.length) parts.push(`alergias=${m.allergies.join(',')}`)
      if (m.conditions.length) parts.push(`condiciones=${m.conditions.join(',')}`)
      if (m.dailyCalorieTarget) parts.push(`kcal=${m.dailyCalorieTarget}`)
      const head = `- ${parts.join('; ')}`
      const extraLines: string[] = []

      if (recipeIndex && m.favoriteRecipeIds.length > 0) {
        const names = m.favoriteRecipeIds
          .slice(0, FAVORITES_PER_MEMBER)
          .map((id) => recipeIndex.get(id))
          .filter((n): n is string => !!n)
        if (names.length) extraLines.push(`  Favoritos: ${names.join(', ')}`)
      }

      const readyDocs = m.documents.filter((d) => d.aiSummaryStatus === 'ready' && d.aiSummary)
      if (readyDocs.length > 0) {
        const shown = readyDocs.slice(0, DOCS_PER_MEMBER)
        for (const d of shown) {
          const trimmed = d.aiSummary!.replace(/\s+/g, ' ').slice(0, DOC_SUMMARY_MAX_CHARS)
          extraLines.push(`  Notas médicas (${d.filename}): ${trimmed}`)
        }
        if (readyDocs.length > shown.length) {
          extraLines.push(`  (+${readyDocs.length - shown.length} documentos más)`)
        }
      }

      return [head, ...extraLines].join('\n')
    })
    .join('\n')

  const inventoryItems = inventory.filter((i) => i.quantity > 0)
  const inventoryLine = inventoryItems
    .slice(0, INVENTORY_PROMPT_LIMIT)
    .map((i) => `${i.name} (${i.quantity} ${i.unit})`)
    .join(', ')
  const inventoryOverflow = inventoryItems.length > INVENTORY_PROMPT_LIMIT
    ? ` (+${inventoryItems.length - INVENTORY_PROMPT_LIMIT} más)`
    : ''

  const mealPlanLines =
    mealPlans
      ?.slice(0, 7)
      .map((p) => {
        const bk = (p.meals.breakfast as { name?: string } | undefined)?.name ?? '-'
        const lu = (p.meals.lunch as { name?: string } | undefined)?.name ?? '-'
        const di = (p.meals.dinner as { name?: string } | undefined)?.name ?? '-'
        return `${p.date}: ${bk} / ${lu} / ${di}`
      })
      .join('\n') ?? ''

  const schoolMenuLines = (schoolMenuEntries ?? [])
    .slice(0, 7)
    .map((e) => `${e.date}: ${e.description}`)
    .join('\n')

  const conditionDirectives = buildConditionDirectives(profiles)

  const availableRecipes = extras?.availableRecipes?.slice(0, RECIPES_AVAILABLE_LIMIT) ?? []
  const availableRecipesLine = availableRecipes.length > 0
    ? availableRecipes.map((r) => `id=${r.id} "${r.name}"`).join('; ')
    : ''

  const activeMember = extras?.activeMemberId
    ? profiles.find((p) => p.id === extras.activeMemberId)
    : undefined
  const activeUserLine = activeMember
    ? `\nUSUARIO ACTIVO: ${activeMember.name} (id=${activeMember.id}). Prioriza sus alergias/condiciones/calorías. Responde dirigiéndote a ${activeMember.name} en segunda persona.\n`
    : ''

  return `Eres NutriBot, asistente de nutrición familiar de NutrIAssistant. Hoy es ${today}. Responde SIEMPRE en español de España, cercano y conciso.

FAMILIA:
${profileLines || '(sin perfiles)'}
${activeUserLine}
DESPENSA: ${inventoryLine || '(vacía)'}${inventoryOverflow}
${mealPlanLines ? `\nPLAN ESTA SEMANA:\n${mealPlanLines}\n` : ''}${schoolMenuLines ? `\nMENÚ ESCOLAR:\n${schoolMenuLines}\n` : ''}${availableRecipesLine ? `\nRECETAS DISPONIBLES: ${availableRecipesLine}\n` : ''}
DIRECTRICES:
- Comprueba SIEMPRE alérgenos y condiciones antes de sugerir nada; ante duda, marca AVISO.
${conditionDirectives ? conditionDirectives + '\n' : ''}- Base mediterránea; no repetir la misma proteína principal más de 2 veces por semana.
- Respuestas concretas, basadas en la despensa disponible.
- Si faltan ingredientes, sugerir qué comprar.

ACCIONES: Cuando el usuario te pida explícitamente añadir o quitar una receta de favoritos para un miembro, termina tu respuesta con UN bloque <actions>JSON</actions> donde JSON es un array. Formato: [{"type":"add_favorite","memberId":"<id>","recipeId":"<id>"}] o [{"type":"remove_favorite","memberId":"<id>","recipeId":"<id>"}]. Usa SOLO los IDs que aparecen en FAMILIA y RECETAS DISPONIBLES. Nunca inventes IDs. No emitas el bloque si el usuario no pidió la acción.`
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
