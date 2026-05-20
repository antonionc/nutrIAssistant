import { requireNativeViewManager } from 'expo-modules-core'
import type { ViewProps } from 'react-native'

export interface TabItem {
  sfSymbol: string
  label: string
}

export interface LiquidGlassTabBarViewProps extends ViewProps {
  tabs: TabItem[]
  selectedIndex: number
  // Forces the native SwiftUI to match the app's theme even when the user
  // has overridden the system appearance. 'auto' = follow system.
  colorScheme?: 'light' | 'dark' | 'auto'
  onTabPress?: (event: { nativeEvent: { index: number } }) => void
}

const NativeView = requireNativeViewManager<LiquidGlassTabBarViewProps>(
  'LiquidGlass'
)

export default NativeView
