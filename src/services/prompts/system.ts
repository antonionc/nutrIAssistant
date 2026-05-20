import { FamilyMember, SchoolMenuEntry } from '../../types/profiles'
import { MealPlan } from '../../types/planner'
import { getAge } from '../../utils/ageUtils'
import { currentLang } from '../../utils/locale'

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
// line-based layout. The model (Qwen 3 1.7B Quantized) has a ~32k native
// context window, but we still scope to the *active* member plus a
// retrieved subset of pantry / docs / favorites — focused context produces
// faster, more accurate replies than dumping the full family roster.
const FAVORITES_PER_MEMBER = 5
const PROMPT_HARD_CAP_CHARS = 4500 // safety net (~1100 tokens) before native overflow

export interface RecipeRef {
  id: string
  name: string
}

export interface RetrievedDocChunk {
  text: string
  filename: string
}

export interface PromptExtras {
  // Map of recipe id → name. Used to resolve favorite names per member and
  // to surface a candidate ID list to the LLM for the <actions> protocol.
  recipeIndex?: Map<string, string>
  // Top recipes the LLM may reference by id in <actions>.
  availableRecipes?: RecipeRef[]
  // Family member currently using the app. The LLM is now scoped to ONLY
  // this member's data — cross-family chatter routinely overflowed the 1B
  // model's KV cache and produced opaque generation failures.
  activeMemberId?: string
  // Free-form notes the active member has saved about themselves. Injected
  // verbatim, capped to 200 chars.
  aboutMeNotes?: string
  // Top-K durable facts auto-extracted from previous chats with this member.
  memberMemories?: string[]
  // Top-K PDF chunks retrieved by semantic similarity to the current query.
  retrievedChunks?: RetrievedDocChunk[]
}

// No literal few-shot here. Small models (Qwen 3 1.7B) over-apply few-shot
// refusal examples — a verbatim "Usuario/Asistente" pair in the prompt
// trained the model to fire the refusal even on clearly on-topic queries
// like "¿Puedes recomendarme una receta?". The hard topic gate
// (src/services/topicGate.ts) is the real filter; the prompt only needs
// to set scope expectations.
const TOPIC_GUARDRAIL_ES = `ÁMBITO: respondes sobre nutrición, alimentación, salud, comidas, recetas, planificación de menús y compras. Si la pregunta es claramente de otro tema (programación, política, deportes, espectáculos, etc.), declina con una frase corta y redirige al ámbito. Para todo lo demás, responde con detalle.`

const TOPIC_GUARDRAIL_EN = `SCOPE: you answer questions about nutrition, food, health, meals, recipes, menu planning and groceries. If a question is clearly off-topic (programming, politics, sports, entertainment, etc.), decline briefly and redirect to scope. For anything else, answer in detail.`

// Section labels emitted in the system prompt body. Localized so the model
// has to translate fewer landmarks and tends to stay in the target language.
const PROMPT_LABELS = {
  es: {
    intro: (today: string) => `Eres NutriBot, asistente de nutrición familiar. Hoy es ${today}. Responde SIEMPRE en español de España, cercano y conciso.`,
    profile: 'PERFIL',
    noProfile: '(sin perfil)',
    activeUser: (name: string, id: string) => `\nUSUARIO ACTIVO: ${name} (id=${id}). Prioriza sus alergias/condiciones/calorías. Responde dirigiéndote a ${name} en segunda persona.\n`,
    aboutMe: (notes: string) => `\nSOBRE MÍ (notas del usuario): ${notes}\n`,
    memories: (lines: string) => `\nRECUERDOS: ${lines}\n`,
    docsHeading: 'DOCUMENTOS MÉDICOS RELEVANTES',
    pantry: 'DESPENSA',
    pantryEmpty: '(vacía)',
    weekPlan: 'PLAN ESTA SEMANA',
    schoolMenu: 'MENÚ ESCOLAR',
    availableRecipes: 'RECETAS DISPONIBLES',
    directivesHeading: 'DIRECTRICES',
    dirAllergens: '- Comprueba SIEMPRE alérgenos y condiciones antes de sugerir nada; ante duda, marca AVISO.',
    dirMediterranean: '- Base mediterránea; varía proteínas a lo largo de la semana.',
    dirConcrete: '- Respuestas concretas, basadas en la despensa disponible.',
    dirShopping: '- Si faltan ingredientes, sugiere qué comprar.',
    dirRecipeFormat:
      '- Para recetas o planes nutricionales: indica los ingredientes con cantidades por ración, pasos breves y numerados, y una estimación de calorías y macros (proteína/carbohidratos/grasa) por ración. Confirma siempre que la propuesta respeta las alergias y condiciones del usuario activo.',
    actionsBlock: 'ACCIONES: Cuando el usuario te pida explícitamente añadir o quitar una receta de favoritos, termina tu respuesta con UN bloque <actions>JSON</actions> donde JSON es un array. Formato: [{"type":"add_favorite","memberId":"<id>","recipeId":"<id>"}] o [{"type":"remove_favorite","memberId":"<id>","recipeId":"<id>"}]. Usa SOLO los IDs de PERFIL y RECETAS DISPONIBLES. Nunca inventes IDs. No emitas el bloque si el usuario no pidió la acción.',
  },
  en: {
    intro: (today: string) => `You are NutriBot, a family-nutrition assistant. Today is ${today}. ALWAYS respond in English, friendly and concise.`,
    profile: 'PROFILE',
    noProfile: '(no profile)',
    activeUser: (name: string, id: string) => `\nACTIVE USER: ${name} (id=${id}). Prioritize their allergies/conditions/calories. Address ${name} in the second person.\n`,
    aboutMe: (notes: string) => `\nABOUT ME (user notes): ${notes}\n`,
    memories: (lines: string) => `\nMEMORIES: ${lines}\n`,
    docsHeading: 'RELEVANT MEDICAL DOCUMENTS',
    pantry: 'PANTRY',
    pantryEmpty: '(empty)',
    weekPlan: 'PLAN THIS WEEK',
    schoolMenu: 'SCHOOL MENU',
    availableRecipes: 'AVAILABLE RECIPES',
    directivesHeading: 'GUIDELINES',
    dirAllergens: '- ALWAYS check allergens and conditions before suggesting anything; if in doubt, flag a WARNING.',
    dirMediterranean: '- Mediterranean baseline; vary proteins throughout the week.',
    dirConcrete: '- Concrete answers, grounded in available pantry items.',
    dirShopping: '- If ingredients are missing, suggest what to buy.',
    dirRecipeFormat:
      "- For recipes or nutrition plans: list ingredients with per-serving quantities, brief numbered steps, and an estimated calories + macros (protein/carbs/fat) per serving. Always confirm the suggestion respects the active user's allergies and conditions.",
    actionsBlock: 'ACTIONS: When the user explicitly asks to add or remove a recipe from favorites, end your reply with ONE <actions>JSON</actions> block where JSON is an array. Format: [{"type":"add_favorite","memberId":"<id>","recipeId":"<id>"}] or [{"type":"remove_favorite","memberId":"<id>","recipeId":"<id>"}]. Use ONLY the IDs from PROFILE and AVAILABLE RECIPES. Never invent IDs. Do not emit the block if the user did not ask for the action.',
  },
} as const

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

function buildMemberLines(member: FamilyMember, recipeIndex?: Map<string, string>): string[] {
  const parts: string[] = [`${member.name} (${member.role}, ${getAge(member.dateOfBirth)}a)`]
  if (member.dietPreference && member.dietPreference !== 'none') parts.push(`dieta=${member.dietPreference}`)
  if (member.allergies.length) parts.push(`alergias=${member.allergies.join(',')}`)
  if (member.conditions.length) parts.push(`condiciones=${member.conditions.join(',')}`)
  if (member.dailyCalorieTarget) parts.push(`kcal=${member.dailyCalorieTarget}`)
  const head = `- id=${member.id}; ${parts.join('; ')}`
  const out: string[] = [head]

  if (recipeIndex && member.favoriteRecipeIds.length > 0) {
    const names = member.favoriteRecipeIds
      .slice(0, FAVORITES_PER_MEMBER)
      .map((id) => recipeIndex.get(id))
      .filter((n): n is string => !!n)
    if (names.length) out.push(`  Favoritos: ${names.join(', ')}`)
  }
  return out
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

  // Active-member scoping. When the active member is known (the normal case
  // since onboarding always selects one), we *only* include that member's
  // data. Falls back to the full family roster for legacy callers / tests.
  const activeMember = extras?.activeMemberId
    ? profiles.find((p) => p.id === extras.activeMemberId)
    : undefined
  const focusedProfiles = activeMember ? [activeMember] : profiles

  const profileLines = focusedProfiles
    .flatMap((m) => buildMemberLines(m, recipeIndex))
    .join('\n')

  const inventoryItems = inventory.filter((i) => i.quantity > 0)
  const inventoryLine = inventoryItems
    .map((i) => `${i.name} (${i.quantity} ${i.unit})`)
    .join(', ')

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

  const conditionDirectives = buildConditionDirectives(focusedProfiles)

  const availableRecipes = extras?.availableRecipes ?? []
  const availableRecipesLine = availableRecipes.length > 0
    ? availableRecipes.map((r) => `id=${r.id} "${r.name}"`).join('; ')
    : ''

  // Pick the language section once. The whole prompt — guardrail, intro,
  // section labels, directives — must be coherent in a single language so
  // the model doesn't drift into the other.
  const lang = currentLang()
  const labels = PROMPT_LABELS[lang]
  const guardrail = lang === 'en' ? TOPIC_GUARDRAIL_EN : TOPIC_GUARDRAIL_ES

  const activeUserLine = activeMember ? labels.activeUser(activeMember.name, activeMember.id) : ''

  const aboutMe = extras?.aboutMeNotes?.trim()
  const aboutMeBlock = aboutMe ? labels.aboutMe(truncate(aboutMe, 200)) : ''

  const memories = (extras?.memberMemories ?? []).filter((m) => m.trim().length > 0)
  const memoriesBlock = memories.length > 0
    ? labels.memories(memories.map((m) => `· ${truncate(m, 120)}`).join(' '))
    : ''

  const chunks = extras?.retrievedChunks ?? []
  const chunksBlock = chunks.length > 0
    ? `\n${labels.docsHeading}:\n${chunks
        .map((c) => `- [${c.filename}] ${truncate(c.text.replace(/\s+/g, ' '), 400)}`)
        .join('\n')}\n`
    : ''

  // `/no_think` is a Qwen 3 directive that suppresses the chain-of-thought
  // <think>…</think> wrapper the model emits by default. Without this the
  // raw thinking leaks into the chat bubble before the actual answer.
  const result = `/no_think
${guardrail}

${labels.intro(today)}

${labels.profile}:
${profileLines || labels.noProfile}
${activeUserLine}${aboutMeBlock}${memoriesBlock}${chunksBlock}
${labels.pantry}: ${inventoryLine || labels.pantryEmpty}
${mealPlanLines ? `\n${labels.weekPlan}:\n${mealPlanLines}\n` : ''}${schoolMenuLines ? `\n${labels.schoolMenu}:\n${schoolMenuLines}\n` : ''}${availableRecipesLine ? `\n${labels.availableRecipes}: ${availableRecipesLine}\n` : ''}
${labels.directivesHeading}:
${labels.dirAllergens}
${conditionDirectives ? conditionDirectives + '\n' : ''}${labels.dirMediterranean}
${labels.dirConcrete}
${labels.dirShopping}
${labels.dirRecipeFormat}

${labels.actionsBlock}`

  // Hard safety net: never let the prompt exceed the budget. Truncating from
  // the *end* preserves the topic guardrail and active member info, which
  // are the most important for correctness.
  return result.length > PROMPT_HARD_CAP_CHARS
    ? result.slice(0, PROMPT_HARD_CAP_CHARS)
    : result
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
