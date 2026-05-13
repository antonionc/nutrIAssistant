import React, {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  FlatList,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Animated,
  ViewStyle,
  ImageStyle,
  TextStyle,
  PermissionsAndroid,
  Alert,
} from 'react-native'
import * as Speech from 'expo-speech'
import { VoiceQuality } from 'expo-speech'
import { getLocales } from 'expo-localization'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../theme'
import { useTheme, ThemeColors } from '../../theme/ThemeContext'
import { AIMessage } from '../../types/ai'
import { useAIEngine } from '../../modules/ai-engine/AIContext'
import { useTranslation } from '../../i18n'
import { MarkdownText } from './MarkdownText'
import { logger } from '../../utils/logger'

// BCP-47 tag for voice recognition + TTS. Falls back to es-ES when the
// device locale is anything other than English (matches the i18n fallback).
function deviceVoiceLocale(): string {
  const lang = getLocales()[0]?.languageCode ?? 'es'
  return lang === 'en' ? 'en-US' : 'es-ES'
}

type BottomSheetFlatListMethods = { scrollToEnd: (opts?: { animated?: boolean }) => void }

let BottomSheet: any = null
let BottomSheetFlatList: any = FlatList
let BottomSheetScrollView: any = ScrollView
let BottomSheetTextInput: any = TextInput

try {
  const bs = require('@gorhom/bottom-sheet')
  BottomSheet = bs.default
  BottomSheetFlatList = bs.BottomSheetFlatList
  BottomSheetScrollView = bs.BottomSheetScrollView
  BottomSheetTextInput = bs.BottomSheetTextInput
} catch {
  logger.info('[AIAssistant] @gorhom/bottom-sheet no disponible — rebuild con npx expo run:ios')
}

// Voice recognition — graceful fallback if native module not available
let Voice: {
  start: (lang: string) => Promise<void>
  stop: () => Promise<void>
  cancel: () => Promise<void>
  destroy: () => Promise<void>
  isAvailable: () => Promise<0 | 1>
  onSpeechStart?: (() => void) | null
  onSpeechEnd?: (() => void) | null
  onSpeechResults?: ((e: { value?: string[] }) => void) | null
  onSpeechPartialResults?: ((e: { value?: string[] }) => void) | null
  onSpeechError?: ((e: { error?: { code?: string; message?: string } }) => void) | null
} | null = null

try {
  Voice = require('@react-native-voice/voice').default
} catch {
  logger.info('[AIAssistant] @react-native-voice/voice no disponible — modo solo texto')
}

// Quality preference order for TTS voice selection
const VOICE_QUALITY_RANK: Record<VoiceQuality, number> = {
  [VoiceQuality.Enhanced]: 2,
  [VoiceQuality.Default]: 1,
}


interface AIAssistantProps {
  onClose?: () => void
}

export const AIAssistant = forwardRef<any, AIAssistantProps>(
  function AIAssistant({ onClose }, ref) {
    const {
      messages,
      isResponding,
      sendMessage,
      clearHistory,
      lastActionToast,
      dismissActionToast,
      pendingFacts,
      acceptPendingFact,
      dismissPendingFact,
    } = useAIEngine()
    const { colors, isDark } = useTheme()
    const tr = useTranslation()
    const { vs, ts } = useMemo(() => makeStyles(colors), [colors])

    const voiceErrorMessage = useCallback((code?: string): string => {
      switch (code) {
        case 'not_allowed':
        case 'permissions':
          return tr.ai.errorPermissionDenied
        case 'recognizer_unavailable':
        case 'recognizer-unavailable':
          return tr.ai.errorRecognizerUnavailable
        case 'network':
        case 'network-error':
          return tr.ai.errorNetwork
        case 'no-speech':
        case 'speech_timeout':
          return tr.ai.errorNoSpeech
        case 'audio':
        case 'audio-capture':
          return tr.ai.errorAudio
        case 'aborted':
          return ''
        default:
          return tr.ai.errorVoiceGeneric
      }
    }, [tr])
    const [input, setInput] = useState('')
    const [isSpeakerOn, setIsSpeakerOn] = useState(false)
    const [isListening, setIsListening] = useState(false)
    const [voiceError, setVoiceError] = useState<string | null>(null)
    const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null)
    const [ttsVoice, setTtsVoice] = useState<string | undefined>(undefined)
    const listRef = useRef<BottomSheetFlatListMethods>(null)
    const pulseAnim = useRef(new Animated.Value(1)).current
    const micAnim = useRef(new Animated.Value(1)).current
    // Track whether results arrived before we clear the listening state
    const gotResultsRef = useRef(false)

    // ── TTS: pick the best voice that matches the device locale ─────────────
    useEffect(() => {
      const targetLocale = deviceVoiceLocale() // e.g., 'es-ES' or 'en-US'
      const targetPrefix = targetLocale.slice(0, 2) // 'es' or 'en'
      Speech.getAvailableVoicesAsync().then((voices) => {
        const candidates = voices.filter(
          (v) => v.language.startsWith(targetPrefix) && v.identifier
        )
        if (candidates.length === 0) return

        // Sort by quality desc, then exact-locale preference (e.g. en-US over en-GB
        // when the device is en-US).
        candidates.sort((a, b) => {
          const qa = VOICE_QUALITY_RANK[a.quality] ?? 1
          const qb = VOICE_QUALITY_RANK[b.quality] ?? 1
          if (qb !== qa) return qb - qa
          const aMatch = a.language === targetLocale ? 1 : 0
          const bMatch = b.language === targetLocale ? 1 : 0
          return bMatch - aMatch
        })

        setTtsVoice(candidates[0].identifier)
        logger.info(`[TTS] Using voice: ${candidates[0].name} (${candidates[0].quality}, ${candidates[0].language})`)
      }).catch(() => {/* use default voice */})
    }, [])

    // ── Check voice recognition availability ─────────────────────────────────
    useEffect(() => {
      if (!Voice) {
        setVoiceAvailable(false)
        return
      }
      Voice.isAvailable().then((available) => {
        setVoiceAvailable(available === 1)
      }).catch(() => setVoiceAvailable(false))
    }, [])

    // ── Setup voice recognition listeners ────────────────────────────────────
    useEffect(() => {
      if (!Voice) return

      Voice.onSpeechStart = () => {
        gotResultsRef.current = false
        setIsListening(true)
        setVoiceError(null)
      }

      Voice.onSpeechPartialResults = (e) => {
        const partial = e.value?.[0]
        if (partial) setInput(partial)
      }

      Voice.onSpeechResults = (e) => {
        const text = e.value?.[0]
        if (text) {
          gotResultsRef.current = true
          setInput(text)
        }
        setIsListening(false)
      }

      Voice.onSpeechEnd = () => {
        setIsListening(false)
        // If recognition ended with no results, give feedback
        if (!gotResultsRef.current) {
          const msg = voiceErrorMessage('no-speech')
          if (msg) {
            setVoiceError(msg)
            setTimeout(() => setVoiceError(null), 3000)
          }
        }
      }

      Voice.onSpeechError = (e) => {
        const code = e.error?.code
        const msg = voiceErrorMessage(code)
        if (msg) {
          setVoiceError(msg)
          setTimeout(() => setVoiceError(null), 4000)
        }
        setIsListening(false)
        logger.warn('[Voice] Error', { code, errorMessage: e.error?.message })
      }

      return () => {
        if (Voice) {
          Voice.onSpeechStart = null
          Voice.onSpeechPartialResults = null
          Voice.onSpeechResults = null
          Voice.onSpeechEnd = null
          Voice.onSpeechError = null
          Voice.destroy().catch(() => {})
        }
      }
    }, [])

    // ── Animations ───────────────────────────────────────────────────────────
    useEffect(() => {
      if (isResponding) {
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          ])
        ).start()
      } else {
        pulseAnim.stopAnimation()
        pulseAnim.setValue(1)
      }
    }, [isResponding, pulseAnim])

    useEffect(() => {
      if (isListening) {
        Animated.loop(
          Animated.sequence([
            Animated.timing(micAnim, { toValue: 1.3, duration: 500, useNativeDriver: true }),
            Animated.timing(micAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
          ])
        ).start()
      } else {
        micAnim.stopAnimation()
        micAnim.setValue(1)
      }
    }, [isListening, micAnim])

    // ── Auto-scroll on new messages ───────────────────────────────────────────
    useEffect(() => {
      if (messages.length > 0) {
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
      }
    }, [messages])

    // ── TTS: speak assistant replies ─────────────────────────────────────────
    useEffect(() => {
      if (!isSpeakerOn) return
      const lastMsg = messages[messages.length - 1]
      if (lastMsg?.role === 'assistant' && !lastMsg.isStreaming && lastMsg.content) {
        Speech.speak(lastMsg.content, {
          language: deviceVoiceLocale(),
          rate: 0.95,
          pitch: 1.0,
          voice: ttsVoice,
        })
      }
    }, [messages, isSpeakerOn, ttsVoice])

    // ── Permissions ───────────────────────────────────────────────────────────
    const requestMicPermission = async (): Promise<boolean> => {
      if (Platform.OS === 'android') {
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
            {
              title: tr.ai.voicePermissionTitle,
              message: tr.ai.voicePermissionMsg,
              buttonPositive: tr.ai.voicePermissionAllow,
              buttonNegative: tr.app.cancel,
            }
          )
          return granted === PermissionsAndroid.RESULTS.GRANTED
        } catch {
          return false
        }
      }
      // iOS: permission was declared in Info.plist; the OS prompts automatically on first use
      return true
    }

    // ── Voice input handler ───────────────────────────────────────────────────
    const handleVoiceInput = useCallback(async () => {
      if (!Voice || voiceAvailable === false) {
        Alert.alert(tr.ai.voiceNotAvailableTitle, tr.ai.voiceNotAvailableMsg)
        return
      }

      // Stop if already listening
      if (isListening) {
        try {
          await Voice.stop()
        } catch {
          await Voice.cancel().catch(() => {})
        }
        setIsListening(false)
        return
      }

      // Stop any active TTS to free the audio session before recording
      await Speech.stop()

      const hasPermission = await requestMicPermission()
      if (!hasPermission) {
        setVoiceError(tr.ai.errorPermissionDenied)
        setTimeout(() => setVoiceError(null), 4000)
        return
      }

      // Destroy any stale session before starting a fresh one
      try {
        await Voice.destroy()
      } catch {/* ignore */}

      try {
        gotResultsRef.current = false
        await Voice.start(deviceVoiceLocale())
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : tr.ai.errorStartMic
        setVoiceError(msg)
        setTimeout(() => setVoiceError(null), 4000)
        logger.warn('[Voice] start() failed:', e)
      }
    }, [isListening, voiceAvailable])

    // ── Send handler ──────────────────────────────────────────────────────────
    const handleSend = useCallback(async () => {
      const text = input.trim()
      if (!text || isResponding) return
      if (isListening && Voice) {
        await Voice.cancel().catch(() => {})
        setIsListening(false)
      }
      setInput('')
      await sendMessage(text)
    }, [input, isResponding, sendMessage, isListening])

    const handleSpeakerToggle = useCallback(() => {
      const next = !isSpeakerOn
      setIsSpeakerOn(next)
      if (!next) Speech.stop()
    }, [isSpeakerOn])

    // ── Render ────────────────────────────────────────────────────────────────
    if (!BottomSheet) return null

    const renderMessage = ({ item }: { item: AIMessage }) => {
      const isUser = item.role === 'user'
      return (
        <View style={[vs.messageRow, isUser && vs.messageRowUser]}>
          {!isUser && (
            <View style={vs.botAvatar}>
              <Image source={require('../../../assets/images/icon.png')} style={vs.botAvatarLogo} />
            </View>
          )}
          <View style={[vs.bubble, isUser ? vs.bubbleUser : vs.bubbleBot]}>
            {!isUser && (
              <Text style={ts.botName}>NutriBot</Text>
            )}
            <MarkdownText content={item.content} isUser={isUser} />
            {item.isStreaming && (
              <Animated.Text style={[ts.cursor, { opacity: pulseAnim }]}>▋</Animated.Text>
            )}
          </View>
        </View>
      )
    }

    const showMicButton = voiceAvailable !== false  // show until we know it's unavailable

    return (
      <BottomSheet
        ref={ref}
        index={-1}
        snapPoints={['50%']}
        enablePanDownToClose
        onClose={onClose}
        backgroundStyle={vs.sheetBackground}
        handleIndicatorStyle={vs.handle}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        enableDynamicSizing={false}
      >
        {/* Regular View — NOT BottomSheetView. BottomSheetView is for dynamic
            sizing; with enableDynamicSizing={false} + fixed snapPoints it
            breaks flex layout and prevents proper scroll containment. */}
        <View style={vs.container}>
          {/* Header */}
          <View style={vs.header}>
            <View style={vs.headerLeft}>
              <Image source={require('../../../assets/images/icon.png')} style={vs.headerLogo} />
              <Text style={ts.title}>NutrIAssistant</Text>
              <View style={vs.statusDot} />
            </View>
            <View style={vs.headerRight}>
              <TouchableOpacity
                style={[vs.headerBtn, isSpeakerOn && vs.headerBtnActive]}
                onPress={handleSpeakerToggle}
              >
                <Text>{isSpeakerOn ? '🔊' : '🔇'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={vs.headerBtn} onPress={clearHistory}>
                <Text style={ts.clearText}>{tr.ai.clear}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Medical disclaimer — persistent, non-dismissible. GDPR Art. 22
              transparency notice for automated decision-style suggestions
              about Art. 9 health data. Must not be hideable on first open;
              we keep it on every reopen for the same reason. */}
          <View style={vs.disclaimerBanner}>
            <Text style={ts.disclaimerText}>{tr.ai.disclaimerShort}</Text>
          </View>

          {/* Voice error banner */}
          {voiceError ? (
            <View style={vs.errorBanner}>
              <Text style={ts.errorText}>{voiceError}</Text>
            </View>
          ) : null}

          {/* AI action confirmation toast (e.g. "✔ Añadido X a favoritos") */}
          {lastActionToast ? (
            <TouchableOpacity onPress={dismissActionToast} activeOpacity={0.85}>
              <View style={vs.actionBanner}>
                <Text style={ts.actionText}>{lastActionToast}</Text>
              </View>
            </TouchableOpacity>
          ) : null}

          {/* Pending fact confirmation. Surfaces what the assistant proposes
              to remember so the user has visibility before persistence. */}
          {pendingFacts.length > 0 ? (
            <View style={vs.factBanner}>
              <Text style={ts.factPrompt}>{tr.memories.pendingBanner}</Text>
              <Text style={ts.factText} numberOfLines={3}>
                {pendingFacts[0].text}
              </Text>
              <View style={vs.factActions}>
                <TouchableOpacity
                  onPress={() => dismissPendingFact(pendingFacts[0])}
                  style={vs.factDismissBtn}
                >
                  <Text style={ts.factDismissText}>{tr.memories.dismiss}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => acceptPendingFact(pendingFacts[0])}
                  style={vs.factAcceptBtn}
                >
                  <Text style={ts.factAcceptText}>{tr.memories.accept}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* Messages */}
          <View style={vs.messagesArea}>
            {messages.length === 0 ? (
              <BottomSheetScrollView
                contentContainerStyle={vs.welcome}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={ts.welcomeEmoji}>👋</Text>
                <Text style={ts.welcomeTitle}>{tr.ai.welcome}</Text>
                <Text style={ts.welcomeText}>{tr.ai.welcomeDesc}</Text>
              </BottomSheetScrollView>
            ) : (
              <BottomSheetFlatList
                ref={listRef}
                data={messages}
                keyExtractor={(item: AIMessage) => item.id}
                renderItem={renderMessage}
                contentContainerStyle={vs.messageList}
                showsVerticalScrollIndicator={true}
                indicatorStyle={isDark ? 'white' : 'black'}
                scrollIndicatorInsets={{ right: 1 }}
                style={vs.messageListContainer}
              />
            )}
          </View>

          {/* Input row */}
          <View style={vs.inputContainer}>
            {showMicButton && (
              <Animated.View style={{ transform: [{ scale: micAnim }] }}>
                <TouchableOpacity
                  style={[vs.micBtn, isListening && vs.micBtnActive]}
                  onPress={handleVoiceInput}
                  disabled={isResponding}
                  accessibilityLabel={isListening ? tr.ai.micStopLabel : tr.ai.micStartLabel}
                >
                  <Text style={ts.micIcon}>{isListening ? '⏹' : '🎙️'}</Text>
                </TouchableOpacity>
              </Animated.View>
            )}
            <BottomSheetTextInput
              style={ts.input}
              value={input}
              onChangeText={setInput}
              placeholder={isListening ? tr.ai.listening : tr.ai.placeholder}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
            <TouchableOpacity
              style={[vs.sendBtn, (!input.trim() || isResponding) && vs.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!input.trim() || isResponding}
            >
              <Text style={ts.sendIcon}>↑</Text>
            </TouchableOpacity>
          </View>
        </View>
      </BottomSheet>
    )
  }
)

function makeStyles(colors: ThemeColors) {
  const vs = StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.background,
      borderRadius: 24,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.18,
      shadowRadius: 16,
      elevation: 24,
      borderWidth: 1,
      borderColor: colors.border,
    } as ViewStyle,
    handle: { backgroundColor: colors.border, width: 40 } as ViewStyle,
    container: {
      flex: 1,
      paddingBottom: Platform.OS === 'ios' ? 34 : 16,
      overflow: 'hidden',
    } as ViewStyle,
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    } as ViewStyle,
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm } as ViewStyle,
    statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.healthGreen } as ViewStyle,
    headerRight: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' } as ViewStyle,
    headerBtn: { padding: Spacing.xs, borderRadius: BorderRadius.sm } as ViewStyle,
    headerBtnActive: { backgroundColor: `${Colors.healthGreen}20` } as ViewStyle,
    disclaimerBanner: {
      backgroundColor: `${Colors.goldenAmber}12`,
      paddingHorizontal: Spacing.md, paddingVertical: 6,
      borderBottomWidth: 1, borderBottomColor: `${Colors.goldenAmber}25`,
    } as ViewStyle,
    errorBanner: {
      backgroundColor: `${Colors.errorRed}15`, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
      borderBottomWidth: 1, borderBottomColor: `${Colors.errorRed}30`,
    } as ViewStyle,
    actionBanner: {
      backgroundColor: `${Colors.healthGreen}18`, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
      borderBottomWidth: 1, borderBottomColor: `${Colors.healthGreen}30`,
    } as ViewStyle,
    factBanner: {
      backgroundColor: `${Colors.goldenAmber}18`,
      paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
      borderBottomWidth: 1, borderBottomColor: `${Colors.goldenAmber}30`,
      gap: Spacing.xs,
    } as ViewStyle,
    factActions: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end' } as ViewStyle,
    factDismissBtn: {
      paddingHorizontal: Spacing.sm, paddingVertical: 6,
      borderRadius: BorderRadius.pill, backgroundColor: 'transparent',
    } as ViewStyle,
    factAcceptBtn: {
      paddingHorizontal: Spacing.md, paddingVertical: 6,
      borderRadius: BorderRadius.pill, backgroundColor: Colors.goldenAmber,
    } as ViewStyle,
    messagesArea: { flex: 1, overflow: 'hidden' } as ViewStyle,
    messageListContainer: { flex: 1 } as ViewStyle,
    welcome: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md, paddingVertical: Spacing.xl } as ViewStyle,
    messageList: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm } as ViewStyle,
    messageRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm, alignItems: 'flex-end' } as ViewStyle,
    messageRowUser: { flexDirection: 'row-reverse' } as ViewStyle,
    headerLogo: { width: 28, height: 28, borderRadius: 6 } as ImageStyle,
    botAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.mintSurface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } as ViewStyle,
    botAvatarLogo: { width: 32, height: 32, borderRadius: 16 } as ImageStyle,
    bubble: { maxWidth: '75%', padding: Spacing.sm, borderRadius: BorderRadius.lg, gap: 4 } as ViewStyle,
    bubbleUser: { backgroundColor: Colors.healthGreen, borderBottomRightRadius: 4 } as ViewStyle,
    bubbleBot: { backgroundColor: colors.mintSurface, borderBottomLeftRadius: 4, ...Shadows.subtle } as ViewStyle,
    inputContainer: {
      flexDirection: 'row', alignItems: 'flex-end',
      paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.sm, gap: Spacing.sm,
      borderTopWidth: 1, borderTopColor: colors.border,
    } as ViewStyle,
    micBtn: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: `${Colors.goldenAmber}20`,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: Colors.goldenAmber,
    } as ViewStyle,
    micBtnActive: {
      backgroundColor: `${Colors.errorRed}20`,
      borderColor: Colors.errorRed,
    } as ViewStyle,
    sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.healthGreen, alignItems: 'center', justifyContent: 'center' } as ViewStyle,
    sendBtnDisabled: { backgroundColor: colors.border } as ViewStyle,
  })

  const ts = StyleSheet.create({
    title: { ...Typography.heading2, color: colors.text } as TextStyle,
    clearText: { ...Typography.body, color: colors.textSecondary } as TextStyle,
    welcomeEmoji: { fontSize: 48 } as TextStyle,
    welcomeTitle: { ...Typography.heading1, color: colors.text, textAlign: 'center' } as TextStyle,
    welcomeText: { ...Typography.body, color: colors.textSecondary, textAlign: 'center' } as TextStyle,
    botName: { ...Typography.overline, color: Colors.forestGreen } as TextStyle,
    cursor: { color: Colors.healthGreen, fontSize: 16 } as TextStyle,
    disclaimerText: { ...Typography.caption, color: colors.textMuted, fontSize: 11, lineHeight: 14 } as TextStyle,
    errorText: { ...Typography.caption, color: Colors.errorRed } as TextStyle,
    actionText: { ...Typography.caption, color: Colors.forestGreen, fontFamily: Typography.heading3.fontFamily } as TextStyle,
    factPrompt: { ...Typography.caption, color: Colors.forestGreen, fontFamily: Typography.heading3.fontFamily } as TextStyle,
    factText: { ...Typography.body, color: colors.text } as TextStyle,
    factDismissText: { ...Typography.caption, color: colors.textSecondary } as TextStyle,
    factAcceptText: { ...Typography.caption, color: Colors.white, fontFamily: Typography.heading3.fontFamily } as TextStyle,
    micIcon: { fontSize: 18 } as TextStyle,
    input: {
      ...Typography.body, color: colors.text,
      flex: 1, backgroundColor: colors.surface, borderRadius: BorderRadius.xl,
      paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
      maxHeight: 100, ...Shadows.subtle,
    } as TextStyle,
    sendIcon: { color: Colors.white, fontSize: 18, fontWeight: 'bold' } as TextStyle,
  })

  return { vs, ts }
}
