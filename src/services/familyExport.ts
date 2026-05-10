import * as FileSystem from 'expo-file-system/legacy'
import * as DocumentPicker from 'expo-document-picker'
import { FamilyMember } from '../types/profiles'
import { getAge } from '../utils/ageUtils'
import { t } from '../i18n'

function formatDate(iso: string): string {
  const d = new Date(iso)
  // undefined → device locale; matches the rest of the app's date formatting.
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

function memberToMarkdown(m: FamilyMember, index: number): string {
  const allergies = m.allergies.length
    ? m.allergies.map((a) => (t.allergens as Record<string, string>)[a] ?? a).join(', ')
    : t.familyExport.none
  const conditions = m.conditions.length
    ? m.conditions
        .map((c) => (t.settings.conditions as Record<string, string>)[c] ?? c)
        .join(', ')
    : t.familyExport.none
  const diet = (t.diets as Record<string, string>)[m.dietPreference] ?? m.dietPreference
  const role = (t.roles as Record<string, string>)[m.role] ?? m.role

  return [
    t.familyExport.memberLine(index + 1, m.name, role, getAge(m.dateOfBirth)),
    t.familyExport.weightHeightDiet(m.weight, m.height, diet),
    t.familyExport.allergiesLabel(allergies),
    t.familyExport.conditionsLabel(conditions),
    m.dailyCalorieTarget ? t.familyExport.calorieGoalLabel(m.dailyCalorieTarget) : '',
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
    `# ${t.familyExport.docTitle}`,
    '',
    t.familyExport.headerLine(familyName, members.length, today),
    '',
    '---',
    '',
    `## ${t.familyExport.membersHeading}`,
    '',
    membersMarkdown,
    '',
    '---',
    '',
    `> ${t.familyExport.footerNote}`,
    `> ${t.familyExport.importNote}`,
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
