import { requireNativeViewManager } from 'expo-modules-core'
import type { ViewProps } from 'react-native'

export interface TabItem {
  sfSymbol: string
  label: string
}

export interface LiquidGlassTabBarViewProps extends ViewProps {
  tabs: TabItem[]
  selectedIndex: number
  onTabPress?: (event: { nativeEvent: { index: number } }) => void
}

const NativeView = requireNativeViewManager<LiquidGlassTabBarViewProps>(
  'LiquidGlass'
)

export default NativeView
