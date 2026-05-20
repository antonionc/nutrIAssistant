import { Ionicons } from '@expo/vector-icons'
import { BlurView } from 'expo-blur'
import React from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Colors, Spacing, BorderRadius, Typography } from '../../theme'
import { useTheme } from '../../theme/ThemeContext'

// BlurView-based tab-bar pill. Used as the cross-platform fallback for
// FloatingLiquidGlassTabBar on Android, web, and pre-iOS-26 devices where
// the native SwiftUI Liquid Glass module isn't available. Positioning is
// the caller's responsibility — this component just paints the pill.

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

const TAB_ICONS: Record<string, { default: IoniconsName; active: IoniconsName }> = {
  index:     { default: 'home-outline',     active: 'home' },
  nutrition: { default: 'calendar-outline', active: 'calendar' },
  recipes:   { default: 'book-outline',     active: 'book' },
  groceries: { default: 'cart-outline',     active: 'cart' },
}

export interface CustomTabBarTab {
  name: string
  label: string
}

export interface CustomTabBarProps {
  tabs: CustomTabBarTab[]
  selectedIndex: number
  onSelect: (index: number) => void
}

export function CustomTabBar({ tabs, selectedIndex, onSelect }: CustomTabBarProps) {
  const { colors, isDark } = useTheme()

  return (
    <View style={styles.pillShadow}>
      <View style={styles.pillClip}>
        <BlurView
          intensity={Platform.OS === 'ios' ? 80 : 100}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        {/* Light wash lifts label contrast over busy backgrounds; the
            native iOS-26 path doesn't need this because UIGlassEffect
            handles legibility itself. */}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: isDark ? 'rgba(30,30,28,0.18)' : 'rgba(255,255,255,0.08)' },
          ]}
        />
        <View style={styles.row} pointerEvents="box-none">
          {tabs.map((tab, index) => {
            const isFocused = selectedIndex === index
            const icons = TAB_ICONS[tab.name]
            return (
              <TouchableOpacity
                key={tab.name}
                accessibilityRole="button"
                accessibilityLabel={tab.label}
                accessibilityState={isFocused ? { selected: true } : {}}
                onPress={() => {
                  if (!isFocused) onSelect(index)
                }}
                activeOpacity={0.7}
                style={styles.tabButton}
              >
                <View style={[styles.tabInner, isFocused && styles.tabInnerActive]}>
                  <Ionicons
                    name={isFocused ? icons?.active ?? 'ellipse' : icons?.default ?? 'ellipse-outline'}
                    size={24}
                    color={isFocused ? Colors.forestGreen : colors.textSecondary}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.label,
                      { color: isFocused ? Colors.forestGreen : colors.textSecondary },
                      isFocused && styles.labelActive,
                    ]}
                  >
                    {tab.label}
                  </Text>
                </View>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // Outer wrapper carries the drop shadow. Cannot have overflow:hidden
  // here on iOS or shadows vanish.
  pillShadow: {
    flex: 1,
    borderRadius: BorderRadius.pill,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.14,
        shadowRadius: 18,
      },
      android: { elevation: 10 },
    }),
  },
  // Inner wrapper clips the BlurView to the pill shape.
  pillClip: {
    flex: 1,
    borderRadius: BorderRadius.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  tabButton: { flex: 1 },
  tabInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
    borderRadius: BorderRadius.pill,
    gap: 3,
  },
  tabInnerActive: {
    backgroundColor: `${Colors.healthGreen}1F`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Colors.healthGreen}33`,
  },
  label: {
    ...Typography.caption,
    fontSize: 11,
  },
  labelActive: {
    fontFamily: Typography.heading3.fontFamily,
  },
})
