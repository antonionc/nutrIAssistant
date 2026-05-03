import React from 'react'
import { Image, Platform, StyleSheet, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Shadows } from '../../theme'
import { useTheme } from '../../theme/ThemeContext'
import { useAIAssistant } from './AIAssistantHost'

const TAB_BAR_GAP = 76 // approximate height of the floating pill bar
const SIDE_MARGIN = 16

// Circular AI launcher pinned to the bottom-right of every screen. Sits above
// the floating pill tab bar so it never gets occluded.
export function AIFloatingButton() {
  const insets = useSafeAreaInsets()
  const { isDark } = useTheme()
  const { open } = useAIAssistant()

  const bottomOffset = insets.bottom + TAB_BAR_GAP + SIDE_MARGIN

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { bottom: bottomOffset, right: SIDE_MARGIN }]}
    >
      <View style={styles.halo}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="AI assistant"
          onPress={open}
          activeOpacity={0.85}
          style={[styles.button, isDark ? styles.buttonDark : styles.buttonLight]}
        >
          <Image
            source={
              isDark
                ? require('../../../assets/images/android-icon-foreground.png')
                : require('../../../assets/images/icon.png')
            }
            style={isDark ? styles.iconDark : styles.icon}
            resizeMode="contain"
          />
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 50,
  },
  // Thin tinted halo around the button — same brand green as the border,
  // ~15% opacity, 4px thick ring. Subtle visual anchor that marks the FAB
  // as the AI affordance without competing with screen content.
  halo: {
    padding: 4,
    borderRadius: 32,
    backgroundColor: `${Colors.healthGreen}26`,
  },
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.healthGreen,
    overflow: 'hidden',
    ...Platform.select({
      ios: Shadows.elevated,
      android: { elevation: 6 },
    }),
  },
  buttonLight: { backgroundColor: Colors.white },
  buttonDark: { backgroundColor: Colors.warmCharcoal },
  icon: { width: 38, height: 38, borderRadius: 19 },
  iconDark: { width: 40, height: 40 },
})
