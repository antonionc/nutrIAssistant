import { Ionicons } from '@expo/vector-icons'
import { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import React, { useRef } from 'react'
import {
  Image,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Shadows, Spacing } from '../../theme'
import { useTheme } from '../../theme/ThemeContext'
import { AIAssistant } from './AIAssistant'

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

const TAB_ICONS: Record<string, { default: IoniconsName; active: IoniconsName }> = {
  index:      { default: 'home-outline',       active: 'home' },
  nutrition:  { default: 'calendar-outline',   active: 'calendar' },
  recipes:    { default: 'book-outline',       active: 'book' },
  groceries:  { default: 'cart-outline',       active: 'cart' },
}

const ICON_COLOR_DEFAULT = 'rgba(255,255,255,0.55)'
const ICON_COLOR_ACTIVE  = Colors.white

export function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const { colors, isDark } = useTheme()
  const assistantRef = useRef<any>(null)

  const openAssistant = () => assistantRef.current?.expand()

  const renderTab = (route: typeof state.routes[0], index: number) => {
    const isFocused = state.index === index
    const icons = TAB_ICONS[route.name]
    return (
      <TabButton
        key={route.key}
        iconName={isFocused ? icons?.active ?? 'ellipse' : icons?.default ?? 'ellipse-outline'}
        isFocused={isFocused}
        onPress={() => { if (!isFocused) navigation.navigate(route.name) }}
      />
    )
  }

  return (
    <>
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <View style={styles.tabBar}>
          {state.routes.slice(0, 2).map((route, index) => renderTab(route, index))}

          {/* Center AI button */}
          <View style={styles.centerContainer}>
            <TouchableOpacity
              style={[styles.aiButton, { backgroundColor: isDark ? Colors.white : colors.background }]}
              onPress={openAssistant}
              activeOpacity={0.85}
            >
              <Image
                source={
                  isDark
                    ? require('../../../assets/images/android-icon-foreground.png')
                    : require('../../../assets/images/icon.png')
                }
                style={isDark ? styles.aiLogoForeground : styles.aiLogo}
                resizeMode="contain"
              />
            </TouchableOpacity>
          </View>

          {state.routes.slice(2).map((route, index) => renderTab(route, index + 2))}
        </View>
      </View>

      <AIAssistant
        ref={assistantRef}
        onClose={() => assistantRef.current?.close()}
      />
    </>
  )
}

function TabButton({
  iconName,
  isFocused,
  onPress,
}: {
  iconName: IoniconsName
  isFocused: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={styles.tabButton}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons
        name={iconName}
        size={23}
        color={isFocused ? ICON_COLOR_ACTIVE : ICON_COLOR_DEFAULT}
      />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.healthGreen,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
      },
      android: { elevation: 8 },
    }),
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    paddingHorizontal: Spacing.sm,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContainer: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiButton: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: Colors.cream, // overridden inline
    alignItems: 'center',
    justifyContent: 'center',
    bottom: 10,
    borderWidth: 2.5,
    borderColor: Colors.healthGreen,
    overflow: 'hidden',
    ...Shadows.elevated,
  },
  aiLogo: {
    width: 40,
    height: 40,
    borderRadius: 16,
  },
  aiLogoForeground: {
    width: 42,
    height: 42,
  },
})
