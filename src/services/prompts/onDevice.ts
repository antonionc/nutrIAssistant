import { FamilyMember } from '../../types/profiles'
import { InventoryItem } from '../../types/inventory'
import { getAge } from '../../utils/ageUtils'

export function buildOnDeviceSystemPrompt(
  profiles: FamilyMember[],
  inventory: InventoryItem[]
): string {
  const familySummary = profiles.map((m) => ({
    name: m.name,
    role: m.role,
    age: getAge(m.dateOfBirth),
    allergies: m.allergies,
    conditions: m.conditions,
    dailyCalorieTarget: m.dailyCalorieTarget,
  }))

  const inventorySummary = inventory
    .filter((i) => i.quantity > 0)
    .map((i) => `${i.name}: ${i.quantity} ${i.unit}`)
    .join(', ')

  return `Eres NutriBot, el experto en nutrición de NutrIAssistant. Ayudas a familias con preguntas nutricionales, identificación de alimentos, revisión de alérgenos y sugerencias de recetas.

Responde SIEMPRE en español de España, de forma cercana y natural.

Perfiles familiares:
${JSON.stringify(familySummary, null, 2)}

Inventario de despensa actual:
${inventorySummary || 'Despensa vacía'}

Reglas:
1. Revisa SIEMPRE los ingredientes frente a las alergias de TODOS los miembros antes de sugerir nada.
2. Usa la dieta mediterránea como base alimentaria.
3. Ante cualquier duda sobre alérgenos, marca como AVISO — nunca asumas que es seguro.
4. Respuestas concisas y prácticas.
5. Para planes de comidas complejos o análisis de PDF, indica que usarás el motor de IA avanzado.`
}
