import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAIEngine } from '../../modules/ai-engine/AIContext'
import { useTheme } from '../../theme/ThemeContext'
import { t } from '../../i18n'

const BAR_HEIGHT = 2
const ANIM_DURATION_MS = 200

// 2 px progress strip pinned under the safe-area inset that mirrors the
// on-device LLM download (~1 GB of Qwen 3 from R2 on first launch). Driven
// by AIContext.modelStatus.downloadProgress; unmounts when load completes or
// fails so it never lingers on a happy-path screen.
export function LLMLoadingBar() {
  const { modelStatus } = useAIEngine()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const widthAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: Math.max(0, Math.min(1, modelStatus.downloadProgress)),
      duration: ANIM_DURATION_MS,
      useNativeDriver: false,
    }).start()
  }, [modelStatus.downloadProgress, widthAnim])

  // Hide whenever the bar has no active progress to communicate:
  //   - model is loaded ('ready' phase, the happy path),
  //   - or load attempt ended in 'error' (provider resets both flags +
  //     downloadProgress=0; chat-side errors take over from there),
  //   - or we haven't started yet (initial state before any phase event).
  // We unmount instead of fading to keep the bar truly non-invasive.
  const isActive =
    !modelStatus.isLoaded &&
    (modelStatus.isDownloading || modelStatus.downloadProgress > 0)
  if (!isActive) return null

  const widthInterpolated = widthAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  })

  return (
    <View
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel={t.ai.modelLoadingA11y}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(modelStatus.downloadProgress * 100),
      }}
      style={[styles.container, { top: insets.top, backgroundColor: colors.primary + '26' }]}
    >
      <Animated.View
        style={[
          styles.fill,
          { width: widthInterpolated, backgroundColor: colors.primary },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: BAR_HEIGHT,
    zIndex: 1000,
  },
  fill: {
    height: BAR_HEIGHT,
  },
})
