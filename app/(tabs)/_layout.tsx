import { Tabs } from 'expo-router'
import { router } from 'expo-router'
import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { LiquidGlassTabBar } from '../../src/components/layout/LiquidGlassTabBar'
import { AIFloatingButton } from '../../src/components/layout/AIFloatingButton'
import { useProfiles } from '../../src/modules/profiles/ProfilesContext'
import { t } from '../../src/i18n'

export default function TabLayout() {
  const { isLoading, needsOnboarding } = useProfiles()

  useEffect(() => {
    if (!isLoading && needsOnboarding) {
      router.replace('/onboarding' as never)
    }
  }, [isLoading, needsOnboarding])

  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          // Float the tab bar over the screen content. Without this,
          // React Navigation reserves layout space at the bottom of every
          // screen for the tab bar, so the screen's own background fills
          // that space and looks like a colored shelf under the floating
          // pill. With position:absolute, the screens use their full
          // height and the existing per-screen 120px bottom spacers keep
          // anything important from hiding behind the pill.
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
          },
        }}
        tabBar={(props) => <LiquidGlassTabBar {...props} />}
      >
        <Tabs.Screen name="index" options={{ title: t.tabs.home }} />
        <Tabs.Screen name="nutrition" options={{ title: t.tabs.nutrition }} />
        <Tabs.Screen name="recipes" options={{ title: t.tabs.recipes }} />
        <Tabs.Screen name="groceries" options={{ title: t.tabs.groceries }} />
      </Tabs>
      <AIFloatingButton />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
