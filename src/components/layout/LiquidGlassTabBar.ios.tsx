import React from 'react'
import { StyleSheet, View } from 'react-native'
import { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { NativeModulesProxy } from 'expo-modules-core'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LiquidGlassTabBarViewNative } from '../../../modules/liquid-glass'
import { CustomTabBar } from './CustomTabBar'
import { t } from '../../i18n'

const isNativeAvailable = !!NativeModulesProxy.LiquidGlass

const SF_SYMBOLS: Record<string, string> = {
  index: 'house',
  nutrition: 'calendar',
  recipes: 'book.closed',
  groceries: 'cart',
}

const TAB_LABEL_KEYS: Record<string, keyof typeof t.tabs> = {
  index: 'home',
  nutrition: 'nutrition',
  recipes: 'recipes',
  groceries: 'groceries',
}

function LiquidGlassTabBarNative({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const barHeight = 56 + insets.bottom

  const tabs = state.routes.map((route) => {
    const labelKey = TAB_LABEL_KEYS[route.name]
    return {
      sfSymbol: SF_SYMBOLS[route.name] ?? 'circle',
      label: descriptors[route.key].options.title ?? (labelKey ? t.tabs[labelKey] : route.name),
    }
  })

  return (
    <View style={[styles.container, { height: barHeight }]}>
      <LiquidGlassTabBarViewNative
        style={StyleSheet.absoluteFill}
        tabs={tabs}
        selectedIndex={state.index}
        onTabPress={(e) => {
          const { index } = e.nativeEvent
          const route = state.routes[index]
          if (route && state.index !== index) {
            navigation.navigate(route.name)
          }
        }}
      />
    </View>
  )
}

export function LiquidGlassTabBar(props: BottomTabBarProps) {
  if (!isNativeAvailable) return <CustomTabBar {...props} />
  return <LiquidGlassTabBarNative {...props} />
}

const styles = StyleSheet.create({
  container: {
    overflow: 'visible',
  },
})
