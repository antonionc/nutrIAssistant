import React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { router, usePathname } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { LiquidGlassTabBarViewNative } from '../../../modules/liquid-glass'
import { CustomTabBar } from './CustomTabBar'
import { useTheme } from '../../theme/ThemeContext'
import { t } from '../../i18n'

// Free-floating tab bar overlay, rendered as a sibling of the AI FAB
// rather than via React-Navigation's `tabBar` prop. Going through
// React-Navigation always wraps the bar in a container that reserves
// safe-area space, which reintroduces the cream "shelf" below the pill
// we're trying to avoid. As an overlay we own the positioning entirely:
// a thin gap above the home-indicator gesture zone, screen content
// scrolling freely behind on every side.

// expo-router's typed routes treat the `(tabs)` group as invisible, so
// the URLs here omit it. `/` is the tabs index (Home), the others are
// just their tab name.
type TabRoute = '/' | '/nutrition' | '/recipes' | '/groceries'

const TABS: ReadonlyArray<{
  name: string
  route: TabRoute
  sfSymbol: string
  labelKey: keyof typeof t.tabs
}> = [
  { name: 'index',     route: '/',           sfSymbol: 'house',       labelKey: 'home' },
  { name: 'nutrition', route: '/nutrition',  sfSymbol: 'calendar',    labelKey: 'nutrition' },
  { name: 'recipes',   route: '/recipes',    sfSymbol: 'book.closed', labelKey: 'recipes' },
  { name: 'groceries', route: '/groceries',  sfSymbol: 'cart',        labelKey: 'groceries' },
]

const isNativeAvailable = requireOptionalNativeModule('LiquidGlass') !== null
const useNativeGlass = Platform.OS === 'ios' && isNativeAvailable

function getSelectedIndex(pathname: string): number {
  // expo-router yields '/' for the tabs index, '/nutrition' for the
  // nutrition tab, etc. The (tabs) group is invisible in the URL.
  if (pathname.endsWith('/nutrition')) return 1
  if (pathname.endsWith('/recipes')) return 2
  if (pathname.endsWith('/groceries')) return 3
  return 0
}

export function FloatingLiquidGlassTabBar() {
  const insets = useSafeAreaInsets()
  const pathname = usePathname()
  const { isDark } = useTheme()
  const selectedIndex = getSelectedIndex(pathname)

  const navigateTo = (index: number) => {
    const target = TABS[index]
    if (target && index !== selectedIndex) router.replace(target.route)
  }

  return (
    <View
      pointerEvents="box-none"
      // Pinned just above the iOS home-indicator gesture zone — a single
      // 8pt gap keeps the pill out of the swipe-up area without leaving a
      // visible cream strip below it.
      style={[styles.container, { bottom: insets.bottom + 8 }]}
    >
      {useNativeGlass ? (
        <LiquidGlassTabBarViewNative
          style={styles.bar}
          tabs={TABS.map((tab) => ({ sfSymbol: tab.sfSymbol, label: t.tabs[tab.labelKey] }))}
          selectedIndex={selectedIndex}
          colorScheme={isDark ? 'dark' : 'light'}
          onTabPress={(e) => navigateTo(e.nativeEvent.index)}
        />
      ) : (
        <CustomTabBar
          tabs={TABS.map((tab) => ({ name: tab.name, label: t.tabs[tab.labelKey] }))}
          selectedIndex={selectedIndex}
          onSelect={navigateTo}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 60,
    zIndex: 40,
  },
  bar: {
    flex: 1,
  },
})
