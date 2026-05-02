import React, { useRef } from 'react'
import { StyleSheet, TouchableOpacity, View, Image } from 'react-native'
import { BlurView } from 'expo-blur'
import { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { NativeModulesProxy } from 'expo-modules-core'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LiquidGlassTabBarViewNative } from '../../../modules/liquid-glass'
import { AIAssistant } from './AIAssistant'
import { CustomTabBar } from './CustomTabBar'
import { Colors, Shadows } from '../../theme'

const isNativeAvailable = !!NativeModulesProxy.LiquidGlass

const SF_SYMBOLS: Record<string, string> = {
  index: 'house',
  nutrition: 'calendar',
  recipes: 'book.closed',
  groceries: 'cart',
}

const TAB_LABELS: Record<string, string> = {
  index: 'Inicio',
  nutrition: 'Nutrición',
  recipes: 'Recetas',
  groceries: 'Compra',
}

function LiquidGlassTabBarNative({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const assistantRef = useRef<any>(null)
  const barHeight = 56 + insets.bottom

  const tabs = state.routes.map((route) => ({
    sfSymbol: SF_SYMBOLS[route.name] ?? 'circle',
    label: descriptors[route.key].options.title ?? TAB_LABELS[route.name] ?? route.name,
  }))

  return (
    <>
      {/* Native view height includes safe area; overflow visible for AI button protrusion */}
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

        {/* Floating AI button — glass-styled, centered, protrudes above bar */}
        <View style={styles.aiButtonWrapper} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.aiButton}
            onPress={() => assistantRef.current?.expand()}
            activeOpacity={0.85}
          >
            <BlurView intensity={80} tint="systemUltraThinMaterial" style={StyleSheet.absoluteFill} />
            <Image
              source={require('../../../assets/images/icon.png')}
              style={styles.aiLogo}
              resizeMode="cover"
            />
          </TouchableOpacity>
        </View>
      </View>

      <AIAssistant
        ref={assistantRef}
        onClose={() => assistantRef.current?.close()}
      />
    </>
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
  aiButtonWrapper: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 0,
    pointerEvents: 'box-none',
  },
  aiButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -12,
    borderWidth: 1.5,
    borderColor: Colors.healthGreen,
    overflow: 'hidden',
    ...Shadows.elevated,
  },
  aiLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
})
