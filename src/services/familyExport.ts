import * as FileSystem from 'expo-file-system/legacy'
import * as DocumentPicker from 'expo-document-picker'
import { FamilyMember } from '../types/profiles'
import { getAge } from '../utils/ageUtils'

const DIET_LABELS: Record<string, string> = {
  none: 'Sin restricción',
  mediterranean: 'Mediterránea',
  vegetarian: 'Vegetariana',
  vegan: 'Vegana',
  pescatarian: 'Pescetariana',
  keto: 'Keto',
}

const ROLE_LABELS: Record<string, string> = {
  father: 'padre',
  mother: 'madre',
  son: 'hijo',
  daughter: 'hija',
  other: 'otro',
}

const ALLERGEN_ES: Record<string, string> = {
  gluten: 'Gluten',
  dairy: 'Lácteos',
  eggs: 'Huevos',
  peanuts: 'Cacahuetes',
  'tree nuts': 'Frutos secos',
  soy: 'Soja',
  fish: 'Pescado',
  shellfish: 'Mariscos',
  sesame: 'Sésamo',
  celery: 'Apio',
  mustard: 'Mostaza',
  lupin: 'Altramuces',
  mollusks: 'Moluscos',
  sulfites: 'Sulfitos',
}

const CONDITIONS_ES: Record<string, string> = {
  hypertension: 'Hipertensión',
  osteoporosis: 'Osteoporosis',
  diabetes_type1: 'Diabetes tipo 1',
  diabetes_type2: 'Diabetes tipo 2',
  celiac: 'Celiaquía',
  lactose_intolerance: 'Intolerancia a la lactosa',
  high_cholesterol: 'Colesterol alto',
  ibs: 'Síndrome del intestino irritable',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

function memberToMarkdown(m: FamilyMember, index: number): string {
  const allergies = m.allergies.length
    ? m.allergies.map((a) => ALLERGEN_ES[a] ?? a).join(', ')
    : 'ninguna'
  const conditions = m.conditions.length
    ? m.conditions.map((c) => CONDITIONS_ES[c] ?? c).join(', ')
    : 'ninguna'
  const diet = DIET_LABELS[m.dietPreference] ?? m.dietPreference
  const role = ROLE_LABELS[m.role] ?? m.role

  return [
    `### ${index + 1}. ${m.name} (${role}, ${getAge(m.dateOfBirth)} años)`,
    `Peso: ${m.weight} kg · Altura: ${m.height} cm · Dieta: ${diet}`,
    `Alergias: ${allergies}`,
    `Condiciones e intolerancias: ${conditions}`,
    m.dailyCalorieTarget ? `Objetivo calórico: ${m.dailyCalorieTarget} kcal/día` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function exportFamilyToMarkdown(
  familyName: string,
  members: FamilyMember[]
): Promise<string> {
  const today = formatDate(new Date().toISOString())
  const membersMarkdown = members.map(memberToMarkdown).join('\n\n')

  const machineData = JSON.stringify({ familyName, members }, null, 2)

  const markdown = [
    '# NutrIAssistant — Copia de Seguridad Familiar',
    '',
    `**Familia:** ${familyName} | **Miembros:** ${members.length} | **Exportado:** ${today}`,
    '',
    '---',
    '',
    '## Miembros de la familia',
    '',
    membersMarkdown,
    '',
    '---',
    '',
    '> Este archivo fue generado automáticamente por NutrIAssistant.',
    '> Para restaurar estos datos, importa este archivo desde Ajustes → Importar familia.',
    '',
    `<!-- nutri-export-v1\n${machineData}\n-->`,
  ].join('\n')

  const fileName = `nutri_familia_${Date.now()}.md`
  const fileUri = `${FileSystem.documentDirectory}${fileName}`
  await FileSystem.writeAsStringAsync(fileUri, markdown, {
    encoding: FileSystem.EncodingType.UTF8,
  })
  return fileUri
}

export async function importFamilyFromFile(): Promise<{
  familyName: string
  members: FamilyMember[]
} | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/markdown', 'text/plain', 'text/x-markdown', '*/*'],
    copyToCacheDirectory: true,
  })
  if (result.canceled || !result.assets?.[0]) return null

  const content = await FileSystem.readAsStringAsync(result.assets[0].uri, {
    encoding: FileSystem.EncodingType.UTF8,
  })

  const match = content.match(/<!--\s*nutri-export-v1\s*([\s\S]*?)\s*-->/)
  if (!match?.[1]) return null

  try {
    const parsed = JSON.parse(match[1])
    if (typeof parsed.familyName !== 'string' || !Array.isArray(parsed.members)) return null
    return { familyName: parsed.familyName, members: parsed.members as FamilyMember[] }
  } catch {
    return null
  }
}
