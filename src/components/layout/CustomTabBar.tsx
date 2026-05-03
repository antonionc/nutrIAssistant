import { Ionicons } from '@expo/vector-icons'
import { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import React from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Spacing, BorderRadius, Typography } from '../../theme'
import { useTheme } from '../../theme/ThemeContext'
import { t } from '../../i18n'

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

const TAB_ICONS: Record<string, { default: IoniconsName; active: IoniconsName }> = {
  index:     { default: 'home-outline',     active: 'home' },
  nutrition: { default: 'calendar-outline', active: 'calendar' },
  recipes:   { default: 'book-outline',     active: 'book' },
  groceries: { default: 'cart-outline',     active: 'cart' },
}

const TAB_LABEL_KEYS: Record<string, keyof typeof t.tabs> = {
  index: 'home',
  nutrition: 'nutrition',
  recipes: 'recipes',
  groceries: 'groceries',
}

export function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.container,
        { paddingBottom: insets.bottom + 12, backgroundColor: colors.background },
      ]}
    >
      <View style={[styles.pill, { backgroundColor: colors.surface }]}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index
          const icons = TAB_ICONS[route.name]
          const labelKey = TAB_LABEL_KEYS[route.name]
          const label = descriptors[route.key].options.title ?? (labelKey ? t.tabs[labelKey] : route.name)

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={isFocused ? { selected: true } : {}}
              onPress={() => {
                if (!isFocused) navigation.navigate(route.name)
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
                  {label}
                </Text>
              </View>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: BorderRadius.pill,
    paddingHorizontal: 6,
    paddingVertical: 6,
    minHeight: 64,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 14,
      },
      android: { elevation: 8 },
    }),
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
    backgroundColor: `${Colors.healthGreen}18`,
  },
  label: {
    ...Typography.caption,
    fontSize: 11,
  },
  labelActive: {
    fontFamily: Typography.heading3.fontFamily,
  },
})
