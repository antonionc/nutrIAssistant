import React, { useState, useEffect } from 'react'
import {
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useProfiles } from '../src/modules/profiles/ProfilesContext'
import { getAge } from '../src/utils/ageUtils'
import { DateOfBirthInput } from '../src/components/inputs/DateOfBirthInput'
import { useTranslation } from '../src/i18n'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../src/theme'
import { useTheme, ThemePreference } from '../src/theme/ThemeContext'
import { FamilyMember, AllergenType, DietPreference } from '../src/types/profiles'
import { EU_14_ALLERGENS, ALLERGEN_DISPLAY_NAMES } from '../src/seed/allergen-rules'
import {
  getLLMStatus,
  downloadModel,
  deleteModel,
  getPreferOnDevice,
  setPreferOnDevice,
} from '../src/services/onDeviceLlm'
import { OnDeviceLLMStatus } from '../src/types/ai'
import { syncRecipes, isSynced } from '../src/modules/recipes/syncRecipes'
import { pickAndSaveAvatar, deleteOldAvatar } from '../src/services/avatarService'
import { exportFamilyToMarkdown, importFamilyFromFile } from '../src/services/familyExport'
import * as Sharing from 'expo-sharing'
import { getRecipeCount } from '../src/modules/recipes/recipeDB'
import Constants from 'expo-constants'

const DIET_OPTIONS: DietPreference[] = ['none', 'mediterranean', 'vegetarian', 'vegan', 'pescatarian', 'keto']
const DIET_LABELS: Record<DietPreference, string> = {
  none: 'Sin restricción',
  mediterranean: 'Mediterránea',
  vegetarian: 'Vegetariana',
  vegan: 'Vegana',
  pescatarian: 'Pescetariana',
  keto: 'Keto',
}
const CONDITIONS_LIST = ['hypertension', 'osteoporosis', 'diabetes_type1', 'diabetes_type2', 'celiac', 'lactose_intolerance', 'high_cholesterol', 'ibs']
const CONDITIONS_LABELS: Record<string, string> = {
  hypertension: 'Hipertensión',
  osteoporosis: 'Osteoporosis',
  diabetes_type1: 'Diabetes tipo 1',
  diabetes_type2: 'Diabetes tipo 2',
  celiac: 'Celiaquía',
  lactose_intolerance: 'Intolerancia lactosa',
  high_cholesterol: 'Colesterol alto',
  ibs: 'Síndrome intestino irritable',
}

export default function SettingsScreen() {
  const tr = useTranslation()
  const { profiles, familyName, addProfile, updateProfile, deleteProfile, setFamilyName, importFamily } = useProfiles()
  const { preference: themePreference, setPreference: setThemePreference } = useTheme()
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null)
  const [llmStatus, setLlmStatus] = useState<OnDeviceLLMStatus>({ isDownloaded: false, isDownloading: false, isLoaded: false, downloadProgress: 0 })
  const [preferOnDevice, setPreferOnDeviceState] = useState(true)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [editingFamilyName, setEditingFamilyName] = useState(false)
  const [familyNameInput, setFamilyNameInput] = useState(familyName)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState(0)
  const [syncMessage, setSyncMessage] = useState('')
  const [recipeCount, setRecipeCount] = useState(0)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  useEffect(() => {
    getLLMStatus().then(setLlmStatus)
    getPreferOnDevice().then(setPreferOnDeviceState)
    getRecipeCount().then(setRecipeCount)
  }, [])

  const handleDownloadModel = async () => {
    setIsDownloading(true)
    try {
      await downloadModel((progress) => {
        setDownloadProgress(progress)
      })
      const status = await getLLMStatus()
      setLlmStatus(status)
    } catch (e) {
      Alert.alert('Error de descarga', e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      setIsDownloading(false)
    }
  }

  const handleDeleteModel = () => {
    Alert.alert('Eliminar modelo IA', 'Esto eliminará el modelo de IA local (~800 MB). Todas las consultas usarán la API en la nube.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        await deleteModel()
        setLlmStatus(await getLLMStatus())
      }},
    ])
  }

  const togglePreferOnDevice = async (val: boolean) => {
    setPreferOnDeviceState(val)
    await setPreferOnDevice(val)
  }

  const handleSyncRecipes = async () => {
    setIsSyncing(true)
    setSyncProgress(0)
    setSyncMessage('')
    try {
      await syncRecipes((progress, message) => {
        setSyncProgress(progress)
        setSyncMessage(message)
      })
      const count = await getRecipeCount()
      setRecipeCount(count)
      Alert.alert('¡Sincronización completa!', `Base de datos actualizada con ${count} recetas.`)
    } catch (e) {
      Alert.alert('Error de sincronización', e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      setIsSyncing(false)
      setSyncProgress(0)
      setSyncMessage('')
    }
  }

  const handleExportFamily = async () => {
    if (profiles.length === 0) {
      Alert.alert('Sin datos', 'No hay perfiles familiares para exportar.')
      return
    }
    setIsExporting(true)
    try {
      const fileUri = await exportFamilyToMarkdown(familyName, profiles)
      const canShare = await Sharing.isAvailableAsync()
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/markdown',
          dialogTitle: 'Exportar copia de seguridad familiar',
          UTI: 'public.plain-text',
        })
      } else {
        Alert.alert('Archivo guardado', `Copia guardada en:\n${fileUri}`)
      }
    } catch (e) {
      Alert.alert('Error al exportar', e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      setIsExporting(false)
    }
  }

  const handleImportFamily = async () => {
    setIsImporting(true)
    try {
      const data = await importFamilyFromFile()
      if (!data) {
        Alert.alert('Archivo no válido', 'No se pudo leer el archivo. Asegúrate de que es una copia de seguridad de NutrIAssistant.')
        return
      }
      Alert.alert(
        `Importar familia "${data.familyName}"`,
        `Se importarán ${data.members.length} miembro${data.members.length !== 1 ? 's' : ''}.\n\nEsto reemplazará todos los perfiles actuales.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Importar',
            onPress: async () => {
              await importFamily(data.familyName, data.members)
              Alert.alert('¡Importación completada!', `Familia "${data.familyName}" restaurada con ${data.members.length} miembros.`)
            },
          },
        ]
      )
    } catch (e) {
      Alert.alert('Error al importar', e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      setIsImporting(false)
    }
  }

  const appVersion = Constants.expoConfig?.version ?? '1.0.0'

  const THEME_OPTIONS: { value: ThemePreference; label: string; emoji: string }[] = [
    { value: 'light', label: 'Claro', emoji: '☀️' },
    { value: 'dark', label: 'Oscuro', emoji: '🌙' },
    { value: 'auto', label: 'Automático', emoji: '🔄' },
  ]

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Apariencia ──────────────────────── */}
        <SectionHeader title="Apariencia" />
        <View style={styles.card}>
          <Text style={styles.label}>Modo de color</Text>
          <View style={styles.themeRow}>
            {THEME_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.themeBtn, themePreference === opt.value && styles.themeBtnActive]}
                onPress={() => setThemePreference(opt.value)}
              >
                <Text style={styles.themeEmoji}>{opt.emoji}</Text>
                <Text style={[styles.themeLabel, themePreference === opt.value && styles.themeLabelActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Perfiles familiares ─────────────── */}
        <View style={styles.card}>
          {/* Family name header */}
          <View style={styles.row}>
            {editingFamilyName ? (
              <View style={[styles.inlineEdit, { flex: 1 }]}>
                <TextInput
                  style={[styles.inlineInput, { flex: 1 }]}
                  value={familyNameInput}
                  onChangeText={setFamilyNameInput}
                  autoFocus
                />
                <TouchableOpacity onPress={async () => { await setFamilyName(familyNameInput); setEditingFamilyName(false) }}>
                  <Text style={styles.saveText}>{tr.app.save}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.familyHeading}>{tr.settings.familyTitle(familyName)}</Text>
                <TouchableOpacity
                  onPress={() => { setFamilyNameInput(familyName); setEditingFamilyName(true) }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="pencil-outline" size={18} color={Colors.healthGreen} />
                </TouchableOpacity>
              </>
            )}
          </View>

          {profiles.map((member) => (
            <MemberProfileRow
              key={member.id}
              member={member}
              isExpanded={expandedMemberId === member.id}
              onToggle={() => setExpandedMemberId(expandedMemberId === member.id ? null : member.id)}
              onUpdate={(updates) => updateProfile(member.id, updates)}
              onDelete={() => {
                Alert.alert('Eliminar perfil', `¿Eliminar a ${member.name}?`, [
                  { text: 'Cancelar', style: 'cancel' },
                  { text: 'Eliminar', style: 'destructive', onPress: () => deleteProfile(member.id) },
                ])
              }}
            />
          ))}

          <TouchableOpacity
            style={styles.addMemberBtn}
            onPress={() => addProfile({
              name: 'Nuevo miembro', role: 'other', dateOfBirth: `${new Date().getFullYear() - 30}-01-01`, weight: 70, height: 170,
              allergies: [], conditions: [], dietPreference: 'none',
              avatarEmoji: '👤', isSchoolAge: false,
              dailyCalorieTarget: 2000, macroTargets: { protein: 150, carbs: 225, fat: 67 },
            })}
          >
            <Text style={styles.addMemberText}>+ Añadir miembro</Text>
          </TouchableOpacity>
        </View>

        {/* ── Motor de IA ─────────────────────── */}
        <SectionHeader title="Motor de IA" />
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Preferir IA local</Text>
            <Switch
              value={preferOnDevice}
              onValueChange={togglePreferOnDevice}
              trackColor={{ true: Colors.healthGreen, false: Colors.light.border }}
              thumbColor={Colors.white}
            />
          </View>
          <Text style={styles.hint}>La IA local es más rápida y privada. Usa la API de Claude cuando no esté disponible.</Text>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Modelo local</Text>
            <Text style={styles.value}>
              {llmStatus.isDownloaded ? '✅ Descargado' : '⬜ No descargado'}
            </Text>
          </View>

          {llmStatus.modelSizeBytes && (
            <Text style={styles.hint}>{(llmStatus.modelSizeBytes / 1e6).toFixed(0)} MB</Text>
          )}

          {isDownloading ? (
            <View style={styles.progressContainer}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressBar, { width: `${downloadProgress * 100}%` }]} />
              </View>
              <Text style={styles.progressText}>{Math.round(downloadProgress * 100)}% — Descargando Llama 3.2 1B...</Text>
            </View>
          ) : llmStatus.isDownloaded ? (
            <TouchableOpacity style={styles.dangerBtn} onPress={handleDeleteModel}>
              <Text style={styles.dangerBtnText}>Eliminar modelo IA</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.primaryBtn} onPress={handleDownloadModel}>
              <Text style={styles.primaryBtnText}>Descargar modelo IA (~800 MB)</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Base de datos de recetas ────────── */}
        <SectionHeader title="Base de datos de recetas" />
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Recetas en local</Text>
            <Text style={styles.value}>{recipeCount} recetas</Text>
          </View>
          <Text style={styles.hint}>Sincroniza para obtener recetas mediterráneas de FatSecret. Requiere conexión a internet.</Text>
          <View style={styles.divider} />
          {isSyncing ? (
            <View style={styles.progressContainer}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressBar, { width: `${Math.round(syncProgress * 100)}%` }]} />
              </View>
              <Text style={styles.progressText}>{Math.round(syncProgress * 100)}% — {syncMessage || 'Sincronizando...'}</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.primaryBtn} onPress={handleSyncRecipes}>
              <Text style={styles.primaryBtnText}>🔄 Sincronizar recetas</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Integraciones de salud ──────────── */}
        <SectionHeader title="Integraciones de salud" />
        <View style={styles.card}>
          <Text style={styles.comingSoon}>🏃 Apple Health & Google Fit — próximamente</Text>
          <Text style={styles.comingSoon}>⌚ Garmin Connect — próximamente</Text>
        </View>

        {/* ── Supermercados ───────────────────── */}
        <SectionHeader title="Supermercados" />
        <View style={styles.card}>
          {([
            { name: 'Amazon',    image: require('../assets/retailers/amazon.png'),    active: true },
            { name: 'Mercadona', image: require('../assets/retailers/mercadona.png'), active: false },
            { name: 'Carrefour', image: require('../assets/retailers/carrefour.png'), active: false },
            { name: 'Alcampo',   image: require('../assets/retailers/Alcampo.png'),   active: false },
            { name: 'DIA',       image: require('../assets/retailers/dia.png'),        active: false },
            { name: 'Lidl',      image: require('../assets/retailers/lidl.png'),       active: false },
          ] as const).map((r) => (
            <View key={r.name} style={styles.retailerRow}>
              <Image source={r.image} style={styles.retailerImage} resizeMode="contain" />
              <Text style={styles.retailerName}>{r.name}</Text>
              {r.active ? (
                <View style={styles.connectedBadge}><Text style={styles.connectedText}>Activo</Text></View>
              ) : (
                <View style={styles.comingSoonBadge}><Text style={styles.comingSoonText}>Próximamente</Text></View>
              )}
            </View>
          ))}
        </View>

        {/* ── Copia de seguridad ─────────────── */}
        <SectionHeader title="Copia de seguridad familiar" />
        <View style={styles.card}>
          <Text style={styles.hint}>Exporta los perfiles de tu familia a un archivo Markdown. Guárdalo en iCloud, Google Drive o email para restaurarlos si cambias de dispositivo.</Text>
          <View style={styles.divider} />
          <TouchableOpacity
            style={[styles.primaryBtn, isExporting && { opacity: 0.7 }]}
            onPress={handleExportFamily}
            disabled={isExporting}
          >
            {isExporting ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.primaryBtnText}>📤 Exportar copia de seguridad</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkBtn, isImporting && { opacity: 0.7 }]}
            onPress={handleImportFamily}
            disabled={isImporting}
          >
            {isImporting ? (
              <ActivityIndicator color={Colors.infoBlue} />
            ) : (
              <Text style={styles.linkBtnText}>📥 Importar desde archivo</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Datos y privacidad ──────────────── */}
        <SectionHeader title="Datos y privacidad" />
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Compartir datos anónimos</Text>
              <Text style={styles.hint}>Ayuda a mejorar NutrIAssistant</Text>
            </View>
            <Switch value={false} trackColor={{ true: Colors.healthGreen, false: Colors.light.border }} />
          </View>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.dangerBtn} onPress={() =>
            Alert.alert('Eliminar todos los datos', 'Esto eliminará permanentemente todos tus perfiles, planes de comidas e inventario. Esta acción no se puede deshacer.', [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Eliminar todo', style: 'destructive', onPress: () => {} },
            ])
          }>
            <Text style={styles.dangerBtnText}>🗑️ Eliminar todos mis datos</Text>
          </TouchableOpacity>
        </View>

        {/* ── Contacto ────────────────────────── */}
        <SectionHeader title="Contacto" />
        <View style={styles.card}>
          <ContactRow label="📧 Email" value="hola@nutriassistant.ai" onPress={() => Linking.openURL('mailto:hola@nutriassistant.ai')} />
          <ContactRow label="📸 Instagram" value="@nutriassistant.ai" onPress={() => Linking.openURL('https://instagram.com/nutriassistant.ai')} />
          <ContactRow label="🌐 Web" value="nutriassistant.ai" onPress={() => Linking.openURL('https://www.nutriassistant.ai')} />
          <View style={styles.divider} />
          <Text style={styles.version}>Versión {appVersion}</Text>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>
}

function ContactRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: Colors.infoBlue }]}>{value}</Text>
    </TouchableOpacity>
  )
}

function MemberProfileRow({
  member,
  isExpanded,
  onToggle,
  onUpdate,
  onDelete,
}: {
  member: FamilyMember
  isExpanded: boolean
  onToggle: () => void
  onUpdate: (updates: Partial<FamilyMember>) => void
  onDelete: () => void
}) {
  const tr = useTranslation()

  async function handleAvatarPress() {
    const newUri = await pickAndSaveAvatar(member.id)
    if (!newUri) return
    if (member.avatarUrl) await deleteOldAvatar(member.avatarUrl)
    onUpdate({ avatarUrl: newUri })
  }

  return (
    <View style={styles.memberSection}>
      <View style={styles.memberHeader}>
        <TouchableOpacity onPress={handleAvatarPress} style={styles.memberAvatarBtn}>
          {member.avatarUrl ? (
            <Image source={{ uri: member.avatarUrl }} style={styles.memberAvatarImage} />
          ) : (
            <Text style={styles.memberEmoji}>{member.avatarEmoji ?? '👤'}</Text>
          )}
          <Text style={styles.memberAvatarEdit}>📷</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} onPress={onToggle}>
          <View style={{ flex: 1 }}>
            <Text style={styles.memberName}>{member.name}</Text>
            <Text style={styles.memberMeta}>{tr.settings.memberRoles[member.role]} · {getAge(member.dateOfBirth)}a · {member.weight}kg</Text>
          </View>
          <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>
      </View>

      {isExpanded && (
        <View style={styles.memberForm}>
          <FormRow label="Nombre">
            <TextInput
              style={styles.formInput}
              value={member.name}
              onChangeText={(v) => onUpdate({ name: v })}
            />
          </FormRow>
          <FormRow label="Fecha de nacimiento">
            <DateOfBirthInput
              value={member.dateOfBirth ?? ''}
              onChange={(iso) => onUpdate({ dateOfBirth: iso })}
            />
          </FormRow>
          <FormRow label="Peso (kg)">
            <TextInput
              style={styles.formInput}
              value={String(member.weight)}
              onChangeText={(v) => onUpdate({ weight: parseFloat(v) || 0 })}
              keyboardType="numeric"
            />
          </FormRow>
          <FormRow label="Altura (cm)">
            <TextInput
              style={styles.formInput}
              value={String(member.height)}
              onChangeText={(v) => onUpdate({ height: parseFloat(v) || 0 })}
              keyboardType="numeric"
            />
          </FormRow>

          <Text style={styles.formLabel}>Alergias</Text>
          <View style={styles.tagGrid}>
            {EU_14_ALLERGENS.map((a) => {
              const active = member.allergies.includes(a)
              return (
                <TouchableOpacity
                  key={a}
                  style={[styles.tag, active && styles.tagActive]}
                  onPress={() => {
                    const allergies = active
                      ? member.allergies.filter((x) => x !== a)
                      : [...member.allergies, a]
                    onUpdate({ allergies })
                  }}
                >
                  <Text style={[styles.tagText, active && styles.tagTextActive]}>
                    {ALLERGEN_DISPLAY_NAMES[a]}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <Text style={styles.formLabel}>Condiciones</Text>
          <View style={styles.tagGrid}>
            {CONDITIONS_LIST.map((c) => {
              const active = member.conditions.includes(c)
              return (
                <TouchableOpacity
                  key={c}
                  style={[styles.tag, active && styles.tagAmber]}
                  onPress={() => {
                    const conditions = active
                      ? member.conditions.filter((x) => x !== c)
                      : [...member.conditions, c]
                    onUpdate({ conditions })
                  }}
                >
                  <Text style={[styles.tagText, active && styles.tagTextAmber]}>
                    {CONDITIONS_LABELS[c] ?? c.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <View style={styles.row}>
            <Text style={styles.formLabel}>Edad escolar</Text>
            <Switch
              value={member.isSchoolAge}
              onValueChange={(v) => onUpdate({ isSchoolAge: v })}
              trackColor={{ true: Colors.healthGreen, false: Colors.light.border }}
            />
          </View>

          <TouchableOpacity style={[styles.dangerBtn, { marginTop: Spacing.sm }]} onPress={onDelete}>
            <Text style={styles.dangerBtnText}>Eliminar a {member.name}</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.divider} />
    </View>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.formRow}>
      <Text style={styles.formRowLabel}>{label}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  scroll: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  sectionHeader: {
    ...Typography.overline, color: Colors.light.textSecondary,
    marginTop: Spacing.md, marginBottom: Spacing.xs, paddingLeft: Spacing.xs,
  },
  card: {
    backgroundColor: Colors.white, borderRadius: BorderRadius.lg,
    padding: Spacing.md, ...Shadows.card, marginBottom: Spacing.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.xs },
  label: { ...Typography.bodyLarge, color: Colors.warmCharcoal, fontFamily: Typography.heading3.fontFamily },
  value: { ...Typography.body, color: Colors.light.textSecondary },
  hint: { ...Typography.caption, color: Colors.light.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: Colors.light.divider, marginVertical: Spacing.sm },
  // Theme picker
  themeRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  themeBtn: {
    flex: 1, alignItems: 'center', paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md, borderWidth: 1.5, borderColor: Colors.light.border,
    backgroundColor: Colors.cream, gap: 4,
  },
  themeBtnActive: { borderColor: Colors.healthGreen, backgroundColor: `${Colors.healthGreen}12` },
  themeEmoji: { fontSize: 22 },
  themeLabel: { ...Typography.caption, color: Colors.light.textSecondary },
  themeLabelActive: { color: Colors.healthGreen, fontFamily: Typography.heading3.fontFamily },
  familyHeading: { ...Typography.heading3, color: Colors.warmCharcoal },
  // Members
  addMemberBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  addMemberText: { ...Typography.bodyLarge, color: Colors.healthGreen, fontFamily: Typography.heading3.fontFamily },
  primaryBtn: {
    backgroundColor: Colors.healthGreen, borderRadius: BorderRadius.pill,
    padding: Spacing.sm, alignItems: 'center', marginTop: Spacing.sm,
  },
  primaryBtnText: { ...Typography.bodyLarge, color: Colors.white, fontFamily: Typography.heading3.fontFamily },
  dangerBtn: {
    backgroundColor: `${Colors.errorRed}15`, borderRadius: BorderRadius.pill,
    padding: Spacing.sm, alignItems: 'center', marginTop: Spacing.sm,
    borderWidth: 1, borderColor: `${Colors.errorRed}40`,
  },
  dangerBtnText: { ...Typography.bodyLarge, color: Colors.errorRed },
  linkBtn: { padding: Spacing.sm, alignItems: 'flex-start' },
  linkBtnText: { ...Typography.bodyLarge, color: Colors.infoBlue },
  progressContainer: { marginTop: Spacing.sm, gap: Spacing.xs },
  progressTrack: { height: 6, backgroundColor: Colors.softMint, borderRadius: 3 },
  progressBar: { height: 6, backgroundColor: Colors.healthGreen, borderRadius: 3 },
  progressText: { ...Typography.caption, color: Colors.light.textSecondary },
  comingSoon: { ...Typography.body, color: Colors.light.textMuted, paddingVertical: Spacing.xs },
  retailerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  retailerImage: { width: 36, height: 36, borderRadius: 6 },
  retailerName: { ...Typography.bodyLarge, color: Colors.warmCharcoal, flex: 1 },
  connectedBadge: { backgroundColor: `${Colors.healthGreen}20`, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.pill },
  connectedText: { ...Typography.caption, color: Colors.healthGreen },
  comingSoonBadge: { backgroundColor: `${Colors.goldenAmber}20`, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.pill },
  comingSoonText: { ...Typography.caption, color: Colors.goldenAmber },
  version: { ...Typography.caption, color: Colors.light.textMuted, textAlign: 'center', marginTop: Spacing.sm },
  memberSection: {},
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  memberAvatarBtn: { position: 'relative' },
  memberAvatarImage: { width: 44, height: 44, borderRadius: 22 },
  memberAvatarEdit: { position: 'absolute', bottom: -2, right: -2, fontSize: 10 },
  memberEmoji: { fontSize: 28 },
  memberName: { ...Typography.bodyLarge, color: Colors.warmCharcoal, fontFamily: Typography.heading3.fontFamily },
  memberMeta: { ...Typography.caption, color: Colors.light.textSecondary },
  expandIcon: { fontSize: 12, color: Colors.light.textMuted },
  memberForm: { gap: Spacing.sm, paddingBottom: Spacing.sm },
  formRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  formRowLabel: { ...Typography.body, color: Colors.warmCharcoal, width: 100 },
  formInput: {
    flex: 1, backgroundColor: Colors.cream, borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
    ...Typography.body, color: Colors.warmCharcoal,
    borderWidth: 1, borderColor: Colors.light.border,
  },
  formLabel: { ...Typography.body, color: Colors.warmCharcoal, fontFamily: Typography.heading3.fontFamily, marginTop: Spacing.sm },
  tagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  tag: {
    paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.pill,
    backgroundColor: Colors.softMint, borderWidth: 1, borderColor: 'transparent',
  },
  tagActive: { backgroundColor: `${Colors.errorRed}20`, borderColor: Colors.errorRed },
  tagAmber: { backgroundColor: `${Colors.goldenAmber}20`, borderColor: Colors.goldenAmber },
  tagText: { ...Typography.caption, color: Colors.warmCharcoal },
  tagTextActive: { color: Colors.errorRed },
  tagTextAmber: { color: Colors.goldenAmber },
  inlineEdit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  inlineInput: {
    ...Typography.body, color: Colors.warmCharcoal,
    borderBottomWidth: 1, borderColor: Colors.healthGreen, minWidth: 100,
  },
  saveText: { ...Typography.body, color: Colors.healthGreen, fontFamily: Typography.heading3.fontFamily },
})
