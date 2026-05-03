import React, { useRef, useState, useEffect, useMemo } from 'react'
import {
  Alert,
  Animated,
  Image,
  ImageSourcePropType,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { getAge } from '../src/utils/ageUtils'
import { DateOfBirthInput } from '../src/components/inputs/DateOfBirthInput'
import { useTranslation } from '../src/i18n'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useProfiles } from '../src/modules/profiles/ProfilesContext'
import { importFamilyFromFile } from '../src/services/familyExport'
import {
  getDefaultAvatarSource,
  pickAndSaveAvatar,
  resolveAvatarUri,
} from '../src/services/avatarService'
import { FamilyMember, AllergenType, DietPreference, MemberRole } from '../src/types/profiles'
import { Colors, Typography, Spacing, BorderRadius } from '../src/theme'
import { useTheme, ThemeColors } from '../src/theme/ThemeContext'
import { EU_14_ALLERGENS } from '../src/seed/allergen-rules'

// ─── Types ──────────────────────────────────────────────────────────────────

type Step =
  | { kind: 'welcome' }
  | { kind: 'familyName' }
  | { kind: 'memberCount' }
  | { kind: 'memberBasic'; index: number }
  | { kind: 'memberHealth'; index: number }
  | { kind: 'memberDone'; index: number }
  | { kind: 'allDone' }

type MemberDraft = Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>

// ─── Constants ───────────────────────────────────────────────────────────────

const ROLES: MemberRole[] = ['father', 'mother', 'son', 'daughter', 'other']

const DIET_VALUES: DietPreference[] = ['none', 'mediterranean', 'vegetarian', 'vegan', 'pescatarian', 'keto']

const CONDITIONS_LIST = [
  'hypertension', 'osteoporosis', 'diabetes_type1', 'diabetes_type2',
  'celiac', 'lactose_intolerance', 'high_cholesterol', 'ibs',
]

function blankDraft(): MemberDraft {
  return {
    name: '',
    role: 'other',
    dateOfBirth: '',
    weight: 0,
    height: 0,
    allergies: [],
    conditions: [],
    dietPreference: 'none',
    isSchoolAge: false,
  }
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { completeOnboarding, importFamily } = useProfiles()
  const { colors } = useTheme()
  const tr = useTranslation()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [step, setStep]               = useState<Step>({ kind: 'welcome' })
  const [familyName, setFamilyName]   = useState('')
  const [memberCount, setMemberCount] = useState(3)
  const [drafts, setDrafts]           = useState<MemberDraft[]>([])
  // Collapsed by default so the Next button is always reachable on small phones.
  const [expandedAllergies, setExpandedAllergies]   = useState(false)
  const [expandedConditions, setExpandedConditions] = useState(false)

  function toggleSection(setter: (v: boolean) => void, current: boolean) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setter(!current)
  }

  // Slide/fade animation refs
  const slideAnim   = useRef(new Animated.Value(0)).current
  const opacityAnim = useRef(new Animated.Value(1)).current

  // Bounce scale for memberDone screen
  const bounceAnim = useRef(new Animated.Value(0)).current

  // Spring-animated progress bar fill (0–1).
  const progressAnim = useRef(new Animated.Value(0)).current

  function animateIn() {
    slideAnim.setValue(-260)
    opacityAnim.setValue(0)
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: 380, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 380, useNativeDriver: true }),
    ]).start()
  }

  function goTo(next: Step, cb?: () => void) {
    // Light haptic punctuates the advance — gives tactile "I moved forward" feedback.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    Animated.parallel([
      Animated.timing(slideAnim,   { toValue: 260, duration: 260, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0,   duration: 240, useNativeDriver: true }),
    ]).start(() => {
      setStep(next)
      cb?.()
      animateIn()
    })
  }

  // Trigger bounce + success haptic on memberDone
  useEffect(() => {
    if (step.kind !== 'memberDone') return
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    bounceAnim.setValue(0)
    Animated.spring(bounceAnim, {
      toValue: 1,
      friction: 4,
      tension: 60,
      useNativeDriver: true,
    }).start()
    const timer = setTimeout(() => {
      const next = step.index + 1 < memberCount
        ? { kind: 'memberBasic' as const, index: step.index + 1 }
        : { kind: 'allDone' as const }
      goTo(next)
    }, 1600)
    return () => clearTimeout(timer)
  }, [step])

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getDraftAvatarSource(draft: MemberDraft): ImageSourcePropType {
    if (draft.avatarUrl) return { uri: resolveAvatarUri(draft.avatarUrl) }
    return getDefaultAvatarSource(draft.role, draft.dateOfBirth)
  }

  async function handlePickAvatar(index: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    const url = await pickAndSaveAvatar(`onboarding-${index}`)
    if (url) updateDraft(index, { avatarUrl: url })
  }

  function updateDraft(index: number, patch: Partial<MemberDraft>) {
    setDrafts((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], ...patch }
      return next
    })
  }

  function handleImportBackup() {
    importFamilyFromFile().then((data) => {
      if (!data) {
        Alert.alert(tr.settings.invalidFileTitle, tr.onboarding.invalidFileMsg)
        return
      }
      Alert.alert(
        tr.settings.importFamilyTitle(data.familyName),
        tr.onboarding.importFamilyMsg(data.members.length),
        [
          { text: tr.app.cancel, style: 'cancel' },
          {
            text: tr.settings.importAlertBtn,
            onPress: async () => {
              await importFamily(data.familyName, data.members)
              router.replace('/(tabs)')
            },
          },
        ]
      )
    })
  }

  // ── Step renderers ─────────────────────────────────────────────────────────

  function renderWelcome() {
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.bigEmoji}>🥗</Text>
        <Text style={styles.welcomeTitle}>{tr.app.name}</Text>
        <Text style={styles.welcomeSubtitle}>{tr.onboarding.welcomeSubtitle}</Text>
        <Text style={styles.welcomeBody}>{tr.onboarding.welcomeBody}</Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => goTo({ kind: 'familyName' })}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>{tr.onboarding.start}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={handleImportBackup}
          activeOpacity={0.7}
        >
          <Text style={styles.linkBtnText}>{tr.onboarding.hasBackup}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  function renderFamilyName() {
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepEmoji}>🏠</Text>
        <Text style={styles.stepTitle}>{tr.onboarding.familyNameTitle}</Text>
        <Text style={styles.stepBody}>{tr.onboarding.familyNameBody}</Text>
        <TextInput
          style={styles.mainInput}
          value={familyName}
          onChangeText={setFamilyName}
          placeholder={tr.onboarding.familyNamePlaceholder}
          placeholderTextColor={colors.textMuted}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => familyName.trim() && goTo({ kind: 'memberCount' })}
        />
        <TouchableOpacity
          style={[styles.primaryBtn, !familyName.trim() && styles.primaryBtnDisabled]}
          onPress={() => familyName.trim() && goTo({ kind: 'memberCount' })}
          activeOpacity={0.85}
          disabled={!familyName.trim()}
        >
          <Text style={styles.primaryBtnText}>{tr.onboarding.next}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  function renderMemberCount() {
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepEmoji}>👨‍👩‍👧‍👦</Text>
        <Text style={styles.stepTitle}>{tr.onboarding.memberCountTitle}</Text>
        <Text style={styles.stepBody}>{tr.onboarding.memberCountBody}</Text>
        <View style={styles.stepper}>
          <TouchableOpacity
            style={styles.stepperBtn}
            onPress={() => setMemberCount((n) => Math.max(1, n - 1))}
            activeOpacity={0.7}
          >
            <Text style={styles.stepperBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.stepperValue}>{memberCount}</Text>
          <TouchableOpacity
            style={styles.stepperBtn}
            onPress={() => setMemberCount((n) => Math.min(10, n + 1))}
            activeOpacity={0.7}
          >
            <Text style={styles.stepperBtnText}>+</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => {
            const initialDrafts = Array.from({ length: memberCount }, blankDraft)
            goTo({ kind: 'memberBasic', index: 0 }, () => setDrafts(initialDrafts))
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>{tr.onboarding.next}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  function renderMemberBasic(index: number) {
    const draft = drafts[index] ?? blankDraft()

    return (
      <ScrollView
        style={styles.scrollStep}
        contentContainerStyle={styles.stepContainer}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.memberIndexLabel}>
          {tr.onboarding.memberOf(index + 1, memberCount)}
        </Text>

        <View style={styles.avatarPickerWrapper}>
          <TouchableOpacity
            onPress={() => handlePickAvatar(index)}
            activeOpacity={0.85}
            accessibilityLabel={tr.onboarding.avatarPickerHint}
          >
            <Image source={getDraftAvatarSource(draft)} style={styles.avatarPickerImage} />
            <View style={styles.avatarPickerCamera}>
              <Ionicons name="camera" size={16} color={Colors.white} />
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarPickerHint}>{tr.onboarding.avatarPickerHint}</Text>
        </View>

        <Text style={styles.stepTitle}>{tr.onboarding.memberName}</Text>

        <TextInput
          style={styles.mainInput}
          value={draft.name}
          onChangeText={(v) => updateDraft(index, { name: v })}
          placeholder={tr.onboarding.memberNamePlaceholder}
          placeholderTextColor={colors.textMuted}
          autoFocus
        />

        <Text style={styles.fieldLabel}>{tr.onboarding.roleLabel}</Text>
        <View style={styles.pillRow}>
          {ROLES.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.pill, draft.role === r && styles.pillActive]}
              onPress={() => updateDraft(index, { role: r })}
              activeOpacity={0.8}
            >
              <Text style={[styles.pillText, draft.role === r && styles.pillTextActive]}>
                {tr.settings.memberRoles[r]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, !draft.name.trim() && styles.primaryBtnDisabled]}
          onPress={() => draft.name.trim() && goTo({ kind: 'memberHealth', index })}
          activeOpacity={0.85}
          disabled={!draft.name.trim()}
        >
          <Text style={styles.primaryBtnText}>{tr.onboarding.next}</Text>
        </TouchableOpacity>
      </ScrollView>
    )
  }

  function renderMemberHealth(index: number) {
    const draft = drafts[index] ?? blankDraft()

    function toggleAllergen(a: AllergenType) {
      const allergies = draft.allergies.includes(a)
        ? draft.allergies.filter((x) => x !== a)
        : [...draft.allergies, a]
      updateDraft(index, { allergies })
    }

    function toggleCondition(c: string) {
      const conditions = draft.conditions.includes(c)
        ? draft.conditions.filter((x) => x !== c)
        : [...draft.conditions, c]
      updateDraft(index, { conditions })
    }

    const canAdvance = draft.dateOfBirth.length >= 10 && draft.weight > 0 && draft.height > 0

    return (
      <ScrollView
        style={styles.scrollStep}
        contentContainerStyle={[styles.stepContainer, { paddingBottom: 80 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.memberIndexLabel}>
          {draft.name} — {tr.onboarding.memberOf(index + 1, memberCount)}
        </Text>
        <Text style={styles.stepTitle}>{tr.onboarding.healthTitle}</Text>

        <View style={styles.dobRow}>
          <Text style={styles.fieldLabel}>{tr.settings.memberFields.dateOfBirth}</Text>
          <DateOfBirthInput
            value={draft.dateOfBirth}
            onChange={(iso) => updateDraft(index, { dateOfBirth: iso })}
          />
        </View>

        <View style={styles.triRow}>
          <View style={styles.triField}>
            <Text style={styles.fieldLabel}>{tr.settings.memberFields.weight}</Text>
            <TextInput
              style={styles.triInput}
              value={draft.weight > 0 ? String(draft.weight) : ''}
              onChangeText={(v) => updateDraft(index, { weight: parseFloat(v) || 0 })}
              placeholder={tr.onboarding.weightPlaceholder}
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
            />
          </View>
          <View style={styles.triField}>
            <Text style={styles.fieldLabel}>{tr.settings.memberFields.height}</Text>
            <TextInput
              style={styles.triInput}
              value={draft.height > 0 ? String(draft.height) : ''}
              onChangeText={(v) => updateDraft(index, { height: parseFloat(v) || 0 })}
              placeholder={tr.onboarding.heightPlaceholder}
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
            />
          </View>
        </View>

        <Text style={styles.fieldLabel}>{tr.onboarding.dietLabel}</Text>
        <View style={styles.pillRow}>
          {DIET_VALUES.map((value) => (
            <TouchableOpacity
              key={value}
              style={[styles.pill, draft.dietPreference === value && styles.pillActive]}
              onPress={() => updateDraft(index, { dietPreference: value })}
              activeOpacity={0.8}
            >
              <Text style={[styles.pillText, draft.dietPreference === value && styles.pillTextActive]}>
                {tr.diets[value]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={styles.collapsibleHeader}
          onPress={() => toggleSection(setExpandedAllergies, expandedAllergies)}
          activeOpacity={0.7}
        >
          <View style={styles.collapsibleHeaderLeft}>
            <Text style={styles.collapsibleTitle}>{tr.onboarding.allergiesLabel}</Text>
            {draft.allergies.length > 0 && (
              <View style={styles.collapsibleCountBadge}>
                <Text style={styles.collapsibleCountText}>{draft.allergies.length}</Text>
              </View>
            )}
          </View>
          <Ionicons
            name={expandedAllergies ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
        {expandedAllergies && (
          <View style={styles.collapsibleBody}>
            <Text style={styles.fieldHint}>{tr.onboarding.allergiesHint}</Text>
            <View style={styles.tagGrid}>
              {EU_14_ALLERGENS.map((a) => {
                const active = draft.allergies.includes(a)
                return (
                  <TouchableOpacity
                    key={a}
                    style={[styles.tag, active && styles.tagAllergenActive]}
                    onPress={() => toggleAllergen(a)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.tagText, active && styles.tagAllergenText]}>
                      {(tr.allergens as Record<string, string>)[a] ?? a}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        )}

        <TouchableOpacity
          style={styles.collapsibleHeader}
          onPress={() => toggleSection(setExpandedConditions, expandedConditions)}
          activeOpacity={0.7}
        >
          <View style={styles.collapsibleHeaderLeft}>
            <Text style={styles.collapsibleTitle}>{tr.onboarding.conditionsLabel}</Text>
            {draft.conditions.length > 0 && (
              <View style={styles.collapsibleCountBadge}>
                <Text style={styles.collapsibleCountText}>{draft.conditions.length}</Text>
              </View>
            )}
          </View>
          <Ionicons
            name={expandedConditions ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
        {expandedConditions && (
          <View style={styles.collapsibleBody}>
            <Text style={styles.fieldHint}>{tr.onboarding.conditionsHint}</Text>
            <View style={styles.tagGrid}>
              {CONDITIONS_LIST.map((c) => {
                const active = draft.conditions.includes(c)
                return (
                  <TouchableOpacity
                    key={c}
                    style={[styles.tag, active && styles.tagConditionActive]}
                    onPress={() => toggleCondition(c)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.tagText, active && styles.tagConditionText]}>
                      {(tr.settings.conditions as Record<string, string>)[c] ?? c}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, !canAdvance && styles.primaryBtnDisabled]}
          onPress={() => canAdvance && goTo({ kind: 'memberDone', index })}
          activeOpacity={0.85}
          disabled={!canAdvance}
        >
          <Text style={styles.primaryBtnText}>{tr.onboarding.addMemberBtn(draft.name)}</Text>
        </TouchableOpacity>
      </ScrollView>
    )
  }

  function renderMemberDone(index: number) {
    const draft = drafts[index] ?? blankDraft()
    const scale = bounceAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] })
    const remaining = memberCount - index - 1

    return (
      <View style={[styles.stepContainer, styles.centerContent]}>
        <Animated.View style={[styles.doneAvatarWrapper, { transform: [{ scale }] }]}>
          <Image
            source={getDraftAvatarSource(draft)}
            style={styles.doneAvatar}
          />
        </Animated.View>
        <Text style={styles.doneTitle}>{tr.onboarding.memberAdded(draft.name)}</Text>
        {remaining > 0 && (
          <Text style={styles.doneSubtitle}>{tr.onboarding.membersRemaining(remaining)}</Text>
        )}
      </View>
    )
  }

  function renderAllDone() {
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.bigEmoji}>🎉</Text>
        <Text style={styles.stepTitle}>{tr.onboarding.allDoneTitle}</Text>
        <Text style={styles.stepBody}>{tr.onboarding.allDoneBody(familyName)}</Text>

        <View style={styles.membersSummary}>
          {drafts.map((d, i) => (
            <View key={i} style={styles.summaryRow}>
              <Image
                source={getDraftAvatarSource(d)}
                style={styles.summaryAvatar}
              />
              <Text style={styles.summaryName}>{d.name}</Text>
              <Text style={styles.summaryMeta}>{tr.settings.memberRoles[d.role]} · {tr.onboarding.summaryAge(getAge(d.dateOfBirth))}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={async () => {
            await completeOnboarding(familyName, drafts)
            router.replace('/(tabs)')
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>{tr.onboarding.startBtn}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Progress bar ───────────────────────────────────────────────────────────

  function getProgress(): number {
    switch (step.kind) {
      case 'welcome':      return 0
      case 'familyName':   return 0.05
      case 'memberCount':  return 0.1
      case 'memberBasic':  return 0.1 + (step.index / memberCount) * 0.8
      case 'memberHealth': return 0.1 + ((step.index + 0.5) / memberCount) * 0.8
      case 'memberDone':   return 0.1 + ((step.index + 1) / memberCount) * 0.8
      case 'allDone':      return 1
    }
  }

  function canGoBack(): boolean {
    return step.kind !== 'welcome' && step.kind !== 'allDone' && step.kind !== 'memberDone'
  }

  function goBack() {
    switch (step.kind) {
      case 'familyName':   goTo({ kind: 'welcome' }); break
      case 'memberCount':  goTo({ kind: 'familyName' }); break
      case 'memberBasic':  goTo(step.index === 0 ? { kind: 'memberCount' } : { kind: 'memberHealth', index: step.index - 1 }); break
      case 'memberHealth': goTo({ kind: 'memberBasic', index: step.index }); break
    }
  }

  function renderStep() {
    switch (step.kind) {
      case 'welcome':      return renderWelcome()
      case 'familyName':   return renderFamilyName()
      case 'memberCount':  return renderMemberCount()
      case 'memberBasic':  return renderMemberBasic(step.index)
      case 'memberHealth': return renderMemberHealth(step.index)
      case 'memberDone':   return renderMemberDone(step.index)
      case 'allDone':      return renderAllDone()
    }
  }

  const progress = getProgress()

  // Spring the progress fill toward the new value whenever the step changes.
  // Fluid fill conveys "I'm advancing" more clearly than instant width snaps.
  useEffect(() => {
    Animated.spring(progressAnim, {
      toValue: progress,
      friction: 7,
      tension: 50,
      useNativeDriver: false,
    }).start()
  }, [progress, progressAnim])

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  })

  return (
    <SafeAreaView style={styles.root}>
      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
      </View>

      {/* Back button */}
      {canGoBack() && (
        <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>{tr.onboarding.back}</Text>
        </TouchableOpacity>
      )}

      {/* Animated step content */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={16}
      >
        <Animated.View
          style={[
            styles.flex,
            {
              transform: [{ translateY: slideAnim }],
              opacity: opacityAnim,
            },
          ]}
        >
          {renderStep()}
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: { flex: 1 },
    progressTrack: {
      height: 4,
      backgroundColor: `${Colors.healthGreen}25`,
      borderRadius: 2,
      marginHorizontal: Spacing.lg,
      marginTop: Spacing.xs,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: Colors.healthGreen,
      borderRadius: 2,
    },
    backBtn: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
    },
    backBtnText: {
      ...Typography.body,
      color: colors.textSecondary,
    },
    scrollStep: {
      flex: 1,
    },
    stepContainer: {
      flex: 1,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.xl,
      gap: Spacing.md,
    },
    centerContent: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    bigEmoji: {
      fontSize: 72,
      textAlign: 'center',
      marginBottom: Spacing.sm,
    },
    welcomeTitle: {
      ...Typography.display,
      color: Colors.healthGreen,
      textAlign: 'center',
    },
    welcomeSubtitle: {
      ...Typography.heading3,
      color: colors.text,
      textAlign: 'center',
      opacity: 0.7,
    },
    welcomeBody: {
      ...Typography.bodyLarge,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 24,
    },
    stepEmoji: {
      fontSize: 48,
      textAlign: 'center',
    },
    stepTitle: {
      ...Typography.heading2,
      color: colors.text,
      textAlign: 'center',
    },
    stepBody: {
      ...Typography.bodyLarge,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 24,
    },
    memberIndexLabel: {
      ...Typography.caption,
      color: Colors.healthGreen,
      textAlign: 'center',
      fontFamily: Typography.heading3.fontFamily,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    mainInput: {
      ...Typography.heading3,
      color: colors.text,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderWidth: 1.5,
      borderColor: colors.border,
      textAlign: 'center',
    },
    fieldLabel: {
      ...Typography.body,
      color: colors.text,
      fontFamily: Typography.heading3.fontFamily,
      marginTop: Spacing.xs,
    },
    fieldHint: {
      ...Typography.caption,
      color: colors.textMuted,
      marginTop: -Spacing.xs,
    },
    // Stepper
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xl,
      marginVertical: Spacing.sm,
    },
    stepperBtn: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: Colors.healthGreen,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperBtnText: {
      fontSize: 28,
      color: Colors.white,
      lineHeight: 32,
    },
    stepperValue: {
      ...Typography.display,
      color: colors.text,
      minWidth: 48,
      textAlign: 'center',
    },
    // Pills
    pillRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    pill: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
      borderRadius: BorderRadius.pill,
      backgroundColor: colors.mintSurface,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    pillActive: {
      backgroundColor: Colors.healthGreen,
      borderColor: Colors.healthGreen,
    },
    pillText: {
      ...Typography.caption,
      color: colors.text,
      fontFamily: Typography.body.fontFamily,
    },
    pillTextActive: {
      color: Colors.white,
      fontFamily: Typography.heading3.fontFamily,
    },
    // Avatar picker (renderMemberBasic)
    avatarPickerWrapper: {
      alignItems: 'center',
      marginVertical: Spacing.md,
      gap: Spacing.xs,
    },
    avatarPickerImage: {
      width: 96,
      height: 96,
      borderRadius: 48,
      borderWidth: 2,
      borderColor: colors.surface,
    },
    avatarPickerCamera: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: Colors.healthGreen,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.background,
    },
    avatarPickerHint: {
      ...Typography.caption,
      color: colors.textMuted,
    },
    // Collapsible sections (allergies / conditions)
    collapsibleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: Spacing.sm,
    },
    collapsibleHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      flex: 1,
    },
    collapsibleTitle: {
      ...Typography.body,
      color: colors.text,
      fontFamily: Typography.heading3.fontFamily,
    },
    collapsibleCountBadge: {
      minWidth: 22,
      height: 22,
      paddingHorizontal: 6,
      borderRadius: 11,
      backgroundColor: Colors.healthGreen,
      alignItems: 'center',
      justifyContent: 'center',
    },
    collapsibleCountText: {
      ...Typography.caption,
      color: Colors.white,
      fontFamily: Typography.heading3.fontFamily,
    },
    collapsibleBody: {
      paddingTop: Spacing.sm,
      gap: Spacing.xs,
    },
    // Three-column row for age/weight/height
    dobRow: {
      gap: 6,
      marginBottom: Spacing.sm,
    },
    triRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    triField: {
      flex: 1,
      gap: 4,
    },
    triInput: {
      ...Typography.bodyLarge,
      color: colors.text,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.sm,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
      borderWidth: 1.5,
      borderColor: colors.border,
      textAlign: 'center',
    },
    // Tag grid
    tagGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    tag: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 5,
      borderRadius: BorderRadius.pill,
      backgroundColor: colors.mintSurface,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    tagAllergenActive: {
      backgroundColor: `${Colors.errorRed}18`,
      borderColor: Colors.errorRed,
    },
    tagConditionActive: {
      backgroundColor: `${Colors.goldenAmber}18`,
      borderColor: Colors.goldenAmber,
    },
    tagText: {
      ...Typography.caption,
      color: colors.text,
    },
    tagAllergenText: {
      color: Colors.errorRed,
      fontFamily: Typography.heading3.fontFamily,
    },
    tagConditionText: {
      color: Colors.goldenAmber,
      fontFamily: Typography.heading3.fontFamily,
    },
    // Member done
    doneAvatarWrapper: {
      marginBottom: Spacing.md,
    },
    doneAvatar: {
      width: 120,
      height: 120,
      borderRadius: 60,
    },
    doneTitle: {
      ...Typography.heading1,
      color: colors.text,
      textAlign: 'center',
    },
    doneSubtitle: {
      ...Typography.bodyLarge,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    // All done summary
    membersSummary: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      gap: Spacing.xs,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: 2,
    },
    summaryAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    summaryName: {
      ...Typography.bodyLarge,
      color: colors.text,
      fontFamily: Typography.heading3.fontFamily,
      flex: 1,
    },
    summaryMeta: {
      ...Typography.caption,
      color: colors.textSecondary,
    },
    // Buttons
    primaryBtn: {
      backgroundColor: Colors.healthGreen,
      borderRadius: BorderRadius.pill,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.xl,
      alignItems: 'center',
      marginTop: Spacing.sm,
    },
    primaryBtnDisabled: {
      backgroundColor: `${Colors.healthGreen}55`,
    },
    primaryBtnText: {
      ...Typography.bodyLarge,
      color: Colors.white,
      fontFamily: Typography.heading3.fontFamily,
    },
    linkBtn: {
      alignItems: 'center',
      paddingVertical: Spacing.sm,
    },
    linkBtnText: {
      ...Typography.body,
      color: Colors.infoBlue,
      textDecorationLine: 'underline',
    },
  })
}
