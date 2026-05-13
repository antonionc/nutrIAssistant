import React, { useState, useEffect, useMemo } from 'react'
import {
  Alert,
  Image,
  Linking,
  Platform,
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
import { useSelectedProfile } from '../src/modules/profiles/SelectedProfileContext'
import { getAge } from '../src/utils/ageUtils'
import { DateOfBirthInput } from '../src/components/inputs/DateOfBirthInput'
import { useTranslation } from '../src/i18n'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../src/theme'
import { useTheme, ThemePreference, ThemeColors } from '../src/theme/ThemeContext'
import { FamilyMember, AllergenType, DietPreference } from '../src/types/profiles'
import { EU_14_ALLERGENS } from '../src/seed/allergen-rules'
import { syncSource, isSynced, wipeAndResetRecipes } from '../src/modules/recipes/syncRecipes'
import {
  getSourcesConfig,
  setSourceEnabled,
  RecipeSourceKey,
  RecipeSourceInfo,
  SOURCE_LABELS,
  DEFAULT_SOURCES_CONFIG,
} from '../src/modules/recipes/recipeSourcesConfig'
import { getSpoonacularQuotaSnapshot } from '../src/services/spoonacular'
import { pickAndSaveAvatar, deleteOldAvatar, getDefaultAvatarSource, getMemberAvatarSource } from '../src/services/avatarService'
import { useHealth } from '../src/modules/health/HealthContext'
import { HealthProviderId } from '../src/modules/health/types'
import { exportFamilyToMarkdown, importFamilyFromFile } from '../src/services/familyExport'
import { exportAllUserData } from '../src/services/userDataExport'
import { eraseAllUserData } from '../src/services/dataErasure'
import { rotateMasterKey } from '../src/services/keyRotation'
import { useConsent, ConsentToggle } from '../src/modules/consent/ConsentContext'
import { router } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { getRecipeCount, cleanDuplicateImageUrls } from '../src/modules/recipes/recipeDB'
import Constants from 'expo-constants'

const DIET_OPTIONS: DietPreference[] = ['none', 'mediterranean', 'vegetarian', 'vegan', 'pescatarian', 'keto']
const CONDITIONS_LIST = ['hypertension', 'osteoporosis', 'diabetes_type1', 'diabetes_type2', 'celiac', 'lactose_intolerance', 'high_cholesterol', 'ibs']

export default function SettingsScreen() {
  const tr = useTranslation()
  const { profiles, familyName, addProfile, updateProfile, deleteProfile, setFamilyName, importFamily } = useProfiles()
  const { isSuperUser, canEdit } = useSelectedProfile()
  const superUserCount = profiles.filter((p) => p.isSuperUser).length
  const { preference: themePreference, setPreference: setThemePreference, colors } = useTheme()
  const { consent: consentState, setToggle: setConsentToggle } = useConsent()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null)
  const [editingFamilyName, setEditingFamilyName] = useState(false)
  const [familyNameInput, setFamilyNameInput] = useState(familyName)
  const [syncingSource, setSyncingSource] = useState<RecipeSourceKey | null>(null)
  const [syncProgress, setSyncProgress] = useState(0)
  const [syncMessage, setSyncMessage] = useState('')
  const [recipeCount, setRecipeCount] = useState(0)
  const [sourcesConfig, setSourcesConfig] = useState<Record<RecipeSourceKey, RecipeSourceInfo>>(DEFAULT_SOURCES_CONFIG)
  // Quota numbers reflect the BFF's global counter, not per-device usage.
  // Initial limit of 0 is replaced on first refreshSourceStats() call below.
  const [spCallsToday, setSpCallsToday] = useState(0)
  const [spCallsRemaining, setSpCallsRemaining] = useState(0)
  const [spDailyLimit, setSpDailyLimit] = useState(0)
  const [isCleaningImages, setIsCleaningImages] = useState(false)
  const [isWipingDB, setIsWipingDB] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  const refreshSourceStats = async () => {
    const [config, count, quota] = await Promise.all([
      getSourcesConfig(),
      getRecipeCount(),
      getSpoonacularQuotaSnapshot(),
    ])
    setSourcesConfig(config)
    setRecipeCount(count)
    setSpCallsToday(quota.used)
    setSpCallsRemaining(quota.remaining)
    setSpDailyLimit(quota.limit)
  }

  useEffect(() => {
    refreshSourceStats()
  }, [])

  const handleSyncSource = async (key: RecipeSourceKey) => {
    if (syncingSource) return
    setSyncingSource(key)
    setSyncProgress(0)
    setSyncMessage('')
    try {
      const count = await syncSource(key, (progress, message) => {
        setSyncProgress(progress)
        setSyncMessage(message)
      })
      await refreshSourceStats()
      Alert.alert(tr.app.ok, tr.settings.syncComplete(SOURCE_LABELS[key].name, count))
    } catch (e) {
      Alert.alert(tr.settings.syncError, e instanceof Error ? e.message : tr.app.error)
    } finally {
      setSyncingSource(null)
      setSyncProgress(0)
      setSyncMessage('')
    }
  }

  const handleToggleSource = async (key: RecipeSourceKey, value: boolean) => {
    await setSourceEnabled(key, value)
    setSourcesConfig((prev) => ({ ...prev, [key]: { ...prev[key], enabled: value } }))
  }

  const handleCleanImages = async () => {
    setIsCleaningImages(true)
    try {
      const removed = await cleanDuplicateImageUrls()
      Alert.alert(tr.settings.cleanImagesTitle, removed > 0
        ? tr.settings.cleanImagesRemoved(removed)
        : tr.settings.cleanImagesNone)
    } catch (e) {
      Alert.alert(tr.app.error, e instanceof Error ? e.message : tr.app.error)
    } finally {
      setIsCleaningImages(false)
    }
  }

  const handleWipeDB = () => {
    Alert.alert(
      tr.settings.wipeDbTitle,
      tr.settings.wipeDbMsg(recipeCount),
      [
        { text: tr.app.cancel, style: 'cancel' },
        {
          text: tr.settings.wipeDbConfirm,
          style: 'destructive',
          onPress: async () => {
            setIsWipingDB(true)
            try {
              await wipeAndResetRecipes()
              await refreshSourceStats()
              Alert.alert(tr.settings.wipeDbDone, tr.settings.wipeDbDoneMsg)
            } catch (e) {
              Alert.alert(tr.app.error, e instanceof Error ? e.message : tr.app.error)
            } finally {
              setIsWipingDB(false)
            }
          },
        },
      ]
    )
  }

  const handleExportFamily = async () => {
    if (profiles.length === 0) {
      Alert.alert(tr.settings.noDataTitle, tr.settings.noDataMsg)
      return
    }
    setIsExporting(true)
    try {
      const fileUri = await exportFamilyToMarkdown(familyName, profiles)
      const canShare = await Sharing.isAvailableAsync()
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/markdown',
          dialogTitle: tr.settings.exportDialogTitle,
          UTI: 'public.plain-text',
        })
      } else {
        Alert.alert(tr.settings.fileSavedTitle, tr.settings.fileSavedMsg(fileUri))
      }
    } catch (e) {
      Alert.alert(tr.settings.exportError, e instanceof Error ? e.message : tr.app.error)
    } finally {
      setIsExporting(false)
    }
  }

  const [isRotatingKey, setIsRotatingKey] = useState(false)
  const handleRotateKey = () => {
    Alert.alert(tr.settings.rotateKeyConfirmTitle, tr.settings.rotateKeyConfirmMsg, [
      { text: tr.app.cancel, style: 'cancel' },
      {
        text: tr.settings.rotateKeyConfirmBtn,
        style: 'destructive',
        onPress: async () => {
          setIsRotatingKey(true)
          try {
            const result = await rotateMasterKey()
            if (result.failed.length > 0) {
              Alert.alert(tr.settings.rotateKeyFailTitle, tr.settings.rotateKeyFailMsg)
            } else {
              const total = Object.values(result.dbRowsUpdated).reduce((a, b) => a + b, 0) +
                result.profilesUpdated + result.filesUpdated
              Alert.alert(tr.settings.rotateKeyOkTitle, tr.settings.rotateKeyOkMsg(total))
            }
          } catch (err) {
            Alert.alert(tr.settings.rotateKeyFailTitle, tr.settings.rotateKeyFailMsg)
          } finally {
            setIsRotatingKey(false)
          }
        },
      },
    ])
  }

  const [isExportingFullData, setIsExportingFullData] = useState(false)
  const handleExportAllData = async () => {
    setIsExportingFullData(true)
    try {
      const { uri, manifest } = await exportAllUserData(appVersion)
      const canShare = await Sharing.isAvailableAsync()
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/zip',
          dialogTitle: tr.settings.exportAllDialogTitle,
          UTI: 'public.zip-archive',
        })
      } else {
        Alert.alert(
          tr.settings.fileSavedTitle,
          tr.settings.fileSavedMsg(uri) + '\n\n' + tr.settings.exportAllRowCounts(JSON.stringify(manifest.rowCounts)),
        )
      }
    } catch (e) {
      Alert.alert(tr.settings.exportError, e instanceof Error ? e.message : tr.app.error)
    } finally {
      setIsExportingFullData(false)
    }
  }

  const handleImportFamily = async () => {
    setIsImporting(true)
    try {
      const data = await importFamilyFromFile()
      if (!data) {
        Alert.alert(tr.settings.invalidFileTitle, tr.settings.invalidFileMsg)
        return
      }
      Alert.alert(
        tr.settings.importFamilyTitle(data.familyName),
        tr.settings.importFamilyMsg(data.members.length),
        [
          { text: tr.app.cancel, style: 'cancel' },
          {
            text: tr.settings.importAlertBtn,
            onPress: async () => {
              await importFamily(data.familyName, data.members)
              Alert.alert(tr.settings.importDoneTitle, tr.settings.importDoneMsg(data.familyName, data.members.length))
            },
          },
        ]
      )
    } catch (e) {
      Alert.alert(tr.settings.importError, e instanceof Error ? e.message : tr.app.error)
    } finally {
      setIsImporting(false)
    }
  }

  const appVersion = Constants.expoConfig?.version ?? '1.0.0'

  const THEME_OPTIONS: { value: ThemePreference; label: string; emoji: string }[] = [
    { value: 'light', label: tr.settings.themeLight, emoji: '☀️' },
    { value: 'dark',  label: tr.settings.themeDark,  emoji: '🌙' },
    { value: 'auto',  label: tr.settings.themeAuto,  emoji: '🔄' },
  ]

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {!isSuperUser && (
          <View style={styles.adminBanner}>
            <Ionicons name="lock-closed-outline" size={16} color={Colors.goldenAmber} />
            <Text style={styles.adminBannerText}>{tr.admin.onlyAdminBanner}</Text>
          </View>
        )}

        {/* ── Apariencia ──────────────────────── */}
        <SectionHeader title={tr.settings.sectAppearance} colors={colors} />
        <View style={styles.card}>
          <Text style={styles.label}>{tr.settings.themeTitle}</Text>
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
                {isSuperUser && (
                  <TouchableOpacity
                    onPress={() => { setFamilyNameInput(familyName); setEditingFamilyName(true) }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="pencil-outline" size={18} color={Colors.healthGreen} />
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          {profiles.map((member) => {
            const editable = canEdit(member.id)
            return (
              <MemberProfileRow
                key={member.id}
                member={member}
                isExpanded={expandedMemberId === member.id}
                editable={editable}
                showAdminToggle={isSuperUser}
                canDeleteOrDemote={!member.isSuperUser || superUserCount > 1}
                onToggle={() => setExpandedMemberId(expandedMemberId === member.id ? null : member.id)}
                onUpdate={(updates) => updateProfile(member.id, updates)}
                onToggleAdmin={() => {
                  // Block demoting the last admin.
                  if (member.isSuperUser && superUserCount <= 1) {
                    Alert.alert(tr.admin.lastAdminTitle, tr.admin.lastAdminMsg)
                    return
                  }
                  updateProfile(member.id, { isSuperUser: !member.isSuperUser })
                }}
                onDelete={() => {
                  if (member.isSuperUser && superUserCount <= 1) {
                    Alert.alert(tr.admin.lastAdminTitle, tr.admin.lastAdminMsg)
                    return
                  }
                  Alert.alert(tr.settings.deleteProfileTitle, tr.settings.deleteProfileMsg(member.name), [
                    { text: tr.app.cancel, style: 'cancel' },
                    { text: tr.app.delete, style: 'destructive', onPress: () => deleteProfile(member.id) },
                  ])
                }}
              />
            )
          })}

          {isSuperUser && (
            <TouchableOpacity
              style={styles.addMemberBtn}
              onPress={() => addProfile({
                name: tr.settings.newMember, role: 'other', dateOfBirth: `${new Date().getFullYear() - 30}-01-01`, weight: 70, height: 170,
                allergies: [], conditions: [], dietPreference: 'none',
                isSchoolAge: false,
                dailyCalorieTarget: 2000, macroTargets: { protein: 150, carbs: 225, fat: 67 },
              })}
            >
              <Text style={styles.addMemberText}>+ {tr.settings.addMember}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Fuentes de recetas ─────────────── */}
        <SectionHeader title={tr.settings.sectRecipeSources} colors={colors} />
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>{tr.settings.totalInDatabase}</Text>
            <Text style={styles.value}>{tr.settings.recipesCount(recipeCount)}</Text>
          </View>
          <Text style={styles.hint}>{tr.settings.imagesAutoFiltered}</Text>
          {isSuperUser && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity
                style={[styles.primaryBtn, isCleaningImages && styles.primaryBtnDisabled]}
                onPress={handleCleanImages}
                disabled={isCleaningImages}
              >
                {isCleaningImages
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={styles.primaryBtnText}>{tr.settings.cleanImagesBtn}</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dangerBtn, isWipingDB && styles.primaryBtnDisabled]}
                onPress={handleWipeDB}
                disabled={isWipingDB || recipeCount === 0}
              >
                {isWipingDB
                  ? <ActivityIndicator color={Colors.errorRed} size="small" />
                  : <Text style={styles.dangerBtnText}>{tr.settings.wipeDbBtn}</Text>
                }
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Recipe sources — consolidated into one compact card */}
        <View style={styles.card}>
          {(['edamam', 'spoonacular', 'themealdb'] as RecipeSourceKey[]).map((key, index) => {
            const config = sourcesConfig[key]
            const label = SOURCE_LABELS[key]
            const isSyncing = syncingSource === key
            const isOver = key === 'spoonacular' && spCallsRemaining < 10
            const syncDisabled = !!syncingSource || isOver
            const lastSyncDate = config.lastSyncedAt
              ? new Date(config.lastSyncedAt).toLocaleDateString()
              : null
            const lastSyncLine = lastSyncDate
              ? `${tr.settings.lastSync(lastSyncDate)}${config.syncedCount > 0 ? tr.settings.recipesSynced(config.syncedCount) : ''}`
              : null
            const callsLine = key === 'spoonacular' && config.enabled && spDailyLimit > 0
              ? tr.settings.callsToday(spCallsToday, spDailyLimit)
              : null

            return (
              <View key={key}>
                {index > 0 && <View style={styles.sourceDivider} />}
                <View style={styles.sourceRow}>
                  <Text style={styles.sourceEmoji}>{label.emoji}</Text>
                  <View style={styles.sourceInfo}>
                    <Text style={styles.sourceName} numberOfLines={1}>{label.name}</Text>
                    <Text style={styles.sourceMeta} numberOfLines={1}>{label.description}</Text>
                    {(callsLine || lastSyncLine) && (
                      <Text style={styles.sourceMeta} numberOfLines={1}>
                        {callsLine}{callsLine && lastSyncLine ? ' · ' : ''}{lastSyncLine}
                      </Text>
                    )}
                  </View>
                  {config.enabled && (
                    isSyncing ? (
                      <ActivityIndicator size="small" color={Colors.healthGreen} style={styles.sourceAction} />
                    ) : (
                      <TouchableOpacity
                        onPress={() => handleSyncSource(key)}
                        disabled={syncDisabled}
                        style={[styles.sourceAction, syncDisabled && styles.sourceActionDisabled]}
                        accessibilityLabel={tr.settings.syncSourceBtn(label.name)}
                      >
                        <Ionicons name="sync" size={20} color={syncDisabled ? colors.textMuted : Colors.healthGreen} />
                      </TouchableOpacity>
                    )
                  )}
                  <Switch
                    value={config.enabled}
                    onValueChange={(v) => handleToggleSource(key, v)}
                    trackColor={{ false: colors.border, true: Colors.healthGreen }}
                    thumbColor={Colors.white}
                    ios_backgroundColor={colors.border}
                  />
                </View>
                {isSyncing && (
                  <View style={styles.progressContainer}>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressBar, { width: `${Math.round(syncProgress * 100)}%` }]} />
                    </View>
                    <Text style={styles.progressText}>{Math.round(syncProgress * 100)}% — {syncMessage || tr.settings.syncing}</Text>
                  </View>
                )}
                {isOver && config.enabled && (
                  <Text style={[styles.hint, { color: Colors.errorRed, marginTop: 4 }]}>
                    {tr.settings.dailyLimitReached}
                  </Text>
                )}
              </View>
            )
          })}
        </View>

        {/* ── Integraciones de salud ──────────── */}
        <SectionHeader title={tr.settings.health} colors={colors} />
        <View style={styles.card}>
          <HealthProvidersSection colors={colors} styles={styles} tr={tr} />
        </View>

        {/* ── Supermercados ───────────────────── */}
        <SectionHeader title={tr.settings.retailers} colors={colors} />
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
                <View style={styles.connectedBadge}><Text style={styles.connectedText}>{tr.settings.retailerActive}</Text></View>
              ) : (
                <View style={styles.comingSoonBadge}><Text style={styles.comingSoonText}>{tr.app.soon}</Text></View>
              )}
            </View>
          ))}
        </View>

        {/* ── Copia de seguridad ─────────────── */}
        {isSuperUser && (
        <>
        <SectionHeader title={tr.settings.sectBackup} colors={colors} />
        <View style={styles.card}>
          <Text style={styles.hint}>{tr.settings.backupHint}</Text>
          <View style={styles.divider} />
          <TouchableOpacity
            style={[styles.primaryBtn, isExporting && { opacity: 0.7 }]}
            onPress={handleExportFamily}
            disabled={isExporting}
          >
            {isExporting ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.primaryBtnText}>{tr.settings.exportBtn}</Text>
            )}
          </TouchableOpacity>
          <View style={styles.divider} />
          <Text style={styles.hint}>{tr.settings.exportAllHint}</Text>
          <TouchableOpacity
            style={[styles.linkBtn, isExportingFullData && { opacity: 0.7 }]}
            onPress={handleExportAllData}
            disabled={isExportingFullData}
          >
            {isExportingFullData ? (
              <ActivityIndicator color={Colors.infoBlue} />
            ) : (
              <Text style={styles.linkBtnText}>{tr.settings.exportAllBtn}</Text>
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
              <Text style={styles.linkBtnText}>{tr.settings.importBtn}</Text>
            )}
          </TouchableOpacity>
        </View>
        </>
        )}

        {/* ── Datos y privacidad ──────────────── */}
        {isSuperUser && (
        <>
        <SectionHeader title={tr.settings.sectDataPrivacy} colors={colors} />
        <View style={styles.card}>
          {/* GDPR Art. 7.3 — withdrawable consent. Each toggle revokes
              the corresponding processing purpose; the affected feature
              entry points (FAB IA, personalized recipes, document
              parsing) react to the flag at runtime via useConsent(). */}
          <Text style={styles.hint}>{tr.consent.sectionHint}</Text>
          {(['health', 'ai', 'documents'] as ConsentToggle[]).map((key) => (
            <View key={key} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{tr.consent.toggles[key].label}</Text>
                <Text style={styles.hint}>{tr.consent.toggles[key].desc}</Text>
              </View>
              <Switch
                value={consentState[key]}
                onValueChange={(v) => setConsentToggle(key, v)}
                trackColor={{ true: Colors.healthGreen, false: colors.border }}
              />
            </View>
          ))}
          {consentState.grantedAt && (
            <Text style={[styles.hint, { fontSize: 11 }]}>
              {tr.consent.grantedAtLabel(consentState.grantedAt)}
            </Text>
          )}
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{tr.settings.shareAnonymousData}</Text>
              <Text style={styles.hint}>{tr.settings.shareAnonymousDataHint}</Text>
            </View>
            <Switch
              value={false}
              disabled
              trackColor={{ true: Colors.healthGreen, false: colors.border }}
            />
          </View>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.linkBtn}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onPress={() => router.push('/audit-log' as any)}
          >
            <Text style={styles.linkBtnText}>{tr.auditLog.openBtn}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkBtn}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onPress={() => router.push('/legal/privacy' as any)}
          >
            <Text style={styles.linkBtnText}>{tr.privacyPolicy.openBtn}</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <Text style={styles.hint}>{tr.settings.rotateKeyHint}</Text>
          <TouchableOpacity
            style={[styles.linkBtn, isRotatingKey && { opacity: 0.7 }]}
            onPress={handleRotateKey}
            disabled={isRotatingKey}
          >
            {isRotatingKey ? (
              <ActivityIndicator color={Colors.infoBlue} />
            ) : (
              <Text style={styles.linkBtnText}>{tr.settings.rotateKeyBtn}</Text>
            )}
          </TouchableOpacity>
          <View style={styles.divider} />
          {/* GDPR Art. 17 right to erasure. Two-step confirmation: the first
              Alert explains what's about to happen; the second is an
              "are you absolutely sure?" final gate before the destructive
              call. After erasure we navigate to onboarding — the database
              schema persists (we DELETE FROM rather than DROP) so the user
              can start fresh without re-running migrations. */}
          <TouchableOpacity style={styles.dangerBtn} onPress={() =>
            Alert.alert(tr.settings.deleteAllDataTitle, tr.settings.deleteAllDataMsg, [
              { text: tr.app.cancel, style: 'cancel' },
              {
                text: tr.settings.deleteAllBtn,
                style: 'destructive',
                onPress: () => {
                  Alert.alert(tr.settings.deleteAllConfirmTitle, tr.settings.deleteAllConfirmMsg, [
                    { text: tr.app.cancel, style: 'cancel' },
                    {
                      text: tr.settings.deleteAllConfirmBtn,
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          const result = await eraseAllUserData()
                          if (result.partialFailures.length === 0) {
                            Alert.alert(tr.settings.deleteAllSuccessTitle, tr.settings.deleteAllSuccessMsg, [
                              { text: 'OK', onPress: () => router.replace('/onboarding') },
                            ])
                          } else {
                            Alert.alert(
                              tr.settings.deleteAllPartialTitle,
                              tr.settings.deleteAllPartialMsg(result.partialFailures.join(', ')),
                              [{ text: 'OK', onPress: () => router.replace('/onboarding') }],
                            )
                          }
                        } catch {
                          Alert.alert(tr.settings.deleteAllErrorTitle, tr.settings.deleteAllErrorMsg)
                        }
                      },
                    },
                  ])
                },
              },
            ])
          }>
            <Text style={styles.dangerBtnText}>{tr.settings.deleteAllDataBtn}</Text>
          </TouchableOpacity>
        </View>
        </>
        )}

        {/* ── Contacto ────────────────────────── */}
        <SectionHeader title={tr.settings.contact} colors={colors} />
        <View style={styles.card}>
          <ContactRow label="📧 Email" value="hola@nutriassistant.ai" onPress={() => Linking.openURL('mailto:hola@nutriassistant.ai')} colors={colors} />
          <ContactRow label="📸 Instagram" value="@nutriassistant.ai" onPress={() => Linking.openURL('https://instagram.com/nutriassistant.ai')} colors={colors} />
          <ContactRow label="🌐 Web" value="nutriassistant.ai" onPress={() => Linking.openURL('https://www.nutriassistant.ai')} colors={colors} />
          <View style={styles.divider} />
          <Text style={styles.version}>{tr.settings.version(appVersion)}</Text>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

function SectionHeader({ title, colors }: { title: string; colors: ThemeColors }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  return <Text style={styles.sectionHeader}>{title}</Text>
}

interface HealthProviderInfo {
  id: HealthProviderId
  name: string
  iconName: keyof typeof Ionicons.glyphMap
  bgColor: string
  platform: 'iOS' | 'Android'
}

function HealthProvidersSection({
  colors,
  styles,
  tr,
}: {
  colors: ThemeColors
  styles: ReturnType<typeof makeStyles>
  tr: ReturnType<typeof useTranslation>
}) {
  const { activeId, data, isLoading, activateProvider, deactivateProvider } = useHealth()
  const [pendingId, setPendingId] = useState<HealthProviderId | null>(null)

  const providers: HealthProviderInfo[] = [
    { id: 'apple_health',   name: tr.settings.healthApple,   iconName: 'heart',       bgColor: '#FA114F', platform: 'iOS' },
    { id: 'health_connect', name: tr.settings.healthConnect, iconName: 'fitness',     bgColor: '#3B6BC8', platform: 'Android' },
  ]

  async function handleToggle(id: HealthProviderId, value: boolean) {
    setPendingId(id)
    try {
      if (value) {
        const ok = await activateProvider(id)
        if (!ok) {
          Alert.alert(tr.settings.health, tr.settings.healthUnavailable(
            providers.find((p) => p.id === id)!.platform
          ))
        }
      } else {
        await deactivateProvider()
      }
    } finally {
      setPendingId(null)
    }
  }

  return (
    <>
      <Text style={styles.healthExclusiveHint}>{tr.settings.healthExclusiveHint}</Text>
      {providers.map((p, index) => {
        const isActive = activeId === p.id
        const platformOk =
          (p.id === 'apple_health' && Platform.OS === 'ios') ||
          (p.id === 'health_connect' && Platform.OS === 'android')
        const disabled = !platformOk || pendingId !== null
        return (
          <View key={p.id}>
            {index > 0 && <View style={styles.divider} />}
            <View style={styles.healthRow}>
              <View style={[styles.healthIcon, { backgroundColor: p.bgColor }]}>
                <Ionicons name={p.iconName} size={20} color={Colors.white} />
              </View>
              <View style={styles.healthInfo}>
                <Text style={styles.healthName}>{p.name}</Text>
                <Text style={styles.healthStatus}>
                  {!platformOk
                    ? tr.settings.healthUnavailable(p.platform)
                    : isActive
                    ? tr.settings.healthConnected
                    : tr.settings.healthNotConnected}
                </Text>
              </View>
              {pendingId === p.id ? (
                <ActivityIndicator size="small" color={Colors.healthGreen} />
              ) : (
                <Switch
                  value={isActive}
                  onValueChange={(v) => handleToggle(p.id, v)}
                  trackColor={{ false: colors.border, true: Colors.healthGreen }}
                  thumbColor={Colors.white}
                  ios_backgroundColor={colors.border}
                  disabled={disabled}
                />
              )}
            </View>
            {isActive && (
              <Text style={styles.healthData}>
                {isLoading
                  ? tr.app.loading
                  : data
                  ? tr.settings.healthSummary(data.steps, data.activeCaloriesBurned)
                  : '—'}
              </Text>
            )}
          </View>
        )
      })}
    </>
  )
}

function ContactRow({ label, value, onPress, colors }: { label: string; value: string; onPress: () => void; colors: ThemeColors }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
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
  editable,
  showAdminToggle,
  canDeleteOrDemote,
  onToggle,
  onUpdate,
  onDelete,
  onToggleAdmin,
}: {
  member: FamilyMember
  isExpanded: boolean
  editable: boolean
  showAdminToggle: boolean
  canDeleteOrDemote: boolean
  onToggle: () => void
  onUpdate: (updates: Partial<FamilyMember>) => void
  onDelete: () => void
  onToggleAdmin: () => void
}) {
  const tr = useTranslation()
  const { updateProfile } = useProfiles()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [avatarError, setAvatarError] = useState(false)
  useEffect(() => { setAvatarError(false) }, [member.avatarUrl])

  async function handleAvatarPress() {
    try {
      const newUri = await pickAndSaveAvatar(member.id)
      if (!newUri) return
      await updateProfile(member.id, { avatarUrl: newUri })
      if (member.avatarUrl) await deleteOldAvatar(member.avatarUrl)
    } catch {
      Alert.alert(tr.app.error, tr.settings.avatarError)
    }
  }

  return (
    <View style={styles.memberSection}>
      <View style={styles.memberHeader}>
        <TouchableOpacity
          onPress={editable ? handleAvatarPress : undefined}
          style={styles.memberAvatarBtn}
          disabled={!editable}
        >
          <Image
            source={
              avatarError
                ? getDefaultAvatarSource(member.role, member.dateOfBirth)
                : getMemberAvatarSource(member)
            }
            style={styles.memberAvatarImage}
            onError={() => setAvatarError(true)}
          />
          {editable && <Text style={styles.memberAvatarEdit}>📷</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} onPress={onToggle}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
              <Text style={styles.memberName}>{member.name}</Text>
              {member.isSuperUser && (
                <View style={styles.adminPill}>
                  <Text style={styles.adminPillText}>{tr.onboarding.adminBadge}</Text>
                </View>
              )}
            </View>
            <Text style={styles.memberMeta}>{tr.settings.memberRoles[member.role]} · {getAge(member.dateOfBirth)}a · {member.weight}kg</Text>
          </View>
          <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>
      </View>

      {isExpanded && !editable && (
        <Text style={[styles.hint, { paddingHorizontal: Spacing.xs, paddingBottom: Spacing.sm }]}>
          {tr.admin.onlyAdminEditMember}
        </Text>
      )}

      {isExpanded && editable && (
        <View style={styles.memberForm}>
          <FormRow label={tr.settings.memberFields.name} colors={colors}>
            <TextInput
              style={styles.formInput}
              value={member.name}
              onChangeText={(v) => onUpdate({ name: v })}
            />
          </FormRow>
          <FormRow label={tr.settings.memberFields.dateOfBirth} colors={colors}>
            <DateOfBirthInput
              value={member.dateOfBirth ?? ''}
              onChange={(iso) => onUpdate({ dateOfBirth: iso })}
            />
          </FormRow>
          <FormRow label={tr.settings.memberFields.weight} colors={colors}>
            <TextInput
              style={styles.formInput}
              value={String(member.weight)}
              onChangeText={(v) => onUpdate({ weight: parseFloat(v) || 0 })}
              keyboardType="numeric"
            />
          </FormRow>
          <FormRow label={tr.settings.memberFields.height} colors={colors}>
            <TextInput
              style={styles.formInput}
              value={String(member.height)}
              onChangeText={(v) => onUpdate({ height: parseFloat(v) || 0 })}
              keyboardType="numeric"
            />
          </FormRow>

          <Text style={styles.formLabel}>{tr.settings.memberFields.allergies}</Text>
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
                    {(tr.allergens as Record<string, string>)[a] ?? a}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <Text style={styles.formLabel}>{tr.settings.memberFields.conditions}</Text>
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
                    {(tr.settings.conditions as Record<string, string>)[c] ?? c.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <View style={styles.row}>
            <Text style={styles.formLabel}>{tr.settings.memberFields.schoolAge}</Text>
            <Switch
              value={member.isSchoolAge}
              onValueChange={(v) => onUpdate({ isSchoolAge: v })}
              trackColor={{ true: Colors.healthGreen, false: colors.border }}
            />
          </View>

          {showAdminToggle && (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>{tr.admin.adminLabel}</Text>
                <Text style={styles.hint}>{tr.admin.adminHint}</Text>
              </View>
              <Switch
                value={member.isSuperUser}
                onValueChange={onToggleAdmin}
                disabled={member.isSuperUser && !canDeleteOrDemote}
                trackColor={{ true: Colors.healthGreen, false: colors.border }}
              />
            </View>
          )}

          <TouchableOpacity
            style={[styles.dangerBtn, { marginTop: Spacing.sm }, !canDeleteOrDemote && styles.primaryBtnDisabled]}
            onPress={onDelete}
            disabled={!canDeleteOrDemote}
          >
            <Text style={styles.dangerBtnText}>{tr.settings.deleteProfileMsg(member.name)}</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.divider} />
    </View>
  )
}

function FormRow({ label, children, colors }: { label: string; children: React.ReactNode; colors: ThemeColors }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={styles.formRow}>
      <Text style={styles.formRowLabel}>{label}</Text>
      {children}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
    sectionHeader: {
      ...Typography.overline, color: colors.textSecondary,
      marginTop: Spacing.md, marginBottom: Spacing.xs, paddingLeft: Spacing.xs,
    },
    card: {
      backgroundColor: colors.surface, borderRadius: BorderRadius.lg,
      padding: Spacing.md, ...Shadows.card, marginBottom: Spacing.sm,
    },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.xs },
    label: { ...Typography.bodyLarge, color: colors.text, fontFamily: Typography.heading3.fontFamily },
    value: { ...Typography.body, color: colors.textSecondary },
    hint: { ...Typography.caption, color: colors.textMuted, marginTop: 2 },
    divider: { height: 1, backgroundColor: colors.divider, marginVertical: Spacing.sm },
    themeRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
    themeBtn: {
      flex: 1, alignItems: 'center', paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md, borderWidth: 1.5, borderColor: colors.border,
      backgroundColor: colors.background, gap: 4,
    },
    themeBtnActive: { borderColor: Colors.healthGreen, backgroundColor: `${Colors.healthGreen}12` },
    themeEmoji: { fontSize: 22 },
    themeLabel: { ...Typography.caption, color: colors.textSecondary },
    themeLabelActive: { color: Colors.healthGreen, fontFamily: Typography.heading3.fontFamily },
    familyHeading: { ...Typography.heading3, color: colors.text },
    addMemberBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
    addMemberText: { ...Typography.bodyLarge, color: Colors.healthGreen, fontFamily: Typography.heading3.fontFamily },
    primaryBtn: {
      backgroundColor: Colors.healthGreen, borderRadius: BorderRadius.pill,
      padding: Spacing.sm, alignItems: 'center', marginTop: Spacing.sm,
    },
    primaryBtnDisabled: { backgroundColor: colors.border },
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
    progressTrack: { height: 6, backgroundColor: colors.mintSurface, borderRadius: 3 },
    progressBar: { height: 6, backgroundColor: Colors.healthGreen, borderRadius: 3 },
    progressText: { ...Typography.caption, color: colors.textSecondary },
    sourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    sourceEmoji: { fontSize: 22 },
    sourceInfo: { flex: 1, minWidth: 0 },
    sourceName: {
      ...Typography.body,
      color: colors.text,
      fontFamily: Typography.heading3.fontFamily,
    },
    sourceMeta: { ...Typography.caption, color: colors.textMuted, marginTop: 1 },
    sourceDivider: { height: 1, backgroundColor: colors.divider, marginVertical: Spacing.xs },
    sourceAction: { padding: Spacing.xs },
    sourceActionDisabled: { opacity: 0.4 },
    healthExclusiveHint: {
      ...Typography.caption,
      color: colors.textMuted,
      marginBottom: Spacing.sm,
    },
    healthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    healthIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    healthInfo: { flex: 1 },
    healthName: {
      ...Typography.body,
      color: colors.text,
      fontFamily: Typography.heading3.fontFamily,
    },
    healthStatus: { ...Typography.caption, color: colors.textMuted, marginTop: 1 },
    healthData: {
      ...Typography.caption,
      color: colors.textSecondary,
      paddingLeft: 36 + Spacing.sm,
      marginTop: 2,
    },
    comingSoon: { ...Typography.body, color: colors.textMuted, paddingVertical: Spacing.xs },
    retailerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
    retailerImage: { width: 36, height: 36, borderRadius: 6 },
    retailerName: { ...Typography.bodyLarge, color: colors.text, flex: 1 },
    connectedBadge: { backgroundColor: `${Colors.healthGreen}20`, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.pill },
    connectedText: { ...Typography.caption, color: Colors.healthGreen },
    comingSoonBadge: { backgroundColor: `${Colors.goldenAmber}20`, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.pill },
    comingSoonText: { ...Typography.caption, color: Colors.goldenAmber },
    version: { ...Typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: Spacing.sm },
    memberSection: {},
    memberHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
    memberAvatarBtn: { position: 'relative' },
    memberAvatarImage: { width: 44, height: 44, borderRadius: 22 },
    memberAvatarEdit: { position: 'absolute', bottom: -2, right: -2, fontSize: 10 },
    memberName: { ...Typography.bodyLarge, color: colors.text, fontFamily: Typography.heading3.fontFamily },
    memberMeta: { ...Typography.caption, color: colors.textSecondary },
    expandIcon: { fontSize: 12, color: colors.textMuted },
    memberForm: { gap: Spacing.sm, paddingBottom: Spacing.sm },
    formRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
    formRowLabel: { ...Typography.body, color: colors.text, width: 100 },
    formInput: {
      flex: 1, backgroundColor: colors.background, borderRadius: BorderRadius.sm,
      paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
      ...Typography.body, color: colors.text,
      borderWidth: 1, borderColor: colors.border,
    },
    formLabel: { ...Typography.body, color: colors.text, fontFamily: Typography.heading3.fontFamily, marginTop: Spacing.sm },
    tagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
    tag: {
      paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.pill,
      backgroundColor: colors.mintSurface, borderWidth: 1, borderColor: 'transparent',
    },
    tagActive: { backgroundColor: `${Colors.errorRed}20`, borderColor: Colors.errorRed },
    tagAmber: { backgroundColor: `${Colors.goldenAmber}20`, borderColor: Colors.goldenAmber },
    tagText: { ...Typography.caption, color: colors.text },
    tagTextActive: { color: Colors.errorRed },
    tagTextAmber: { color: Colors.goldenAmber },
    inlineEdit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    inlineInput: {
      ...Typography.body, color: colors.text,
      borderBottomWidth: 1, borderColor: Colors.healthGreen, minWidth: 100,
    },
    saveText: { ...Typography.body, color: Colors.healthGreen, fontFamily: Typography.heading3.fontFamily },
    adminBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: `${Colors.goldenAmber}18`,
      borderRadius: BorderRadius.md,
      padding: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    adminBannerText: { ...Typography.caption, color: colors.text, flex: 1 },
    adminPill: {
      backgroundColor: Colors.softMint,
      paddingHorizontal: Spacing.xs + 2,
      paddingVertical: 1,
      borderRadius: BorderRadius.pill,
    },
    adminPillText: {
      ...Typography.caption,
      color: Colors.forestGreen,
      fontFamily: Typography.heading3.fontFamily,
    },
  })
}
