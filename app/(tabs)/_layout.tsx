import { Tabs } from 'expo-router'
import { router } from 'expo-router'
import React, { useEffect } from 'react'
import { LiquidGlassTabBar } from '../../src/components/layout/LiquidGlassTabBar'
import { useProfiles } from '../../src/modules/profiles/ProfilesContext'

export default function TabLayout() {
  const { isLoading, needsOnboarding } = useProfiles()

  useEffect(() => {
    if (!isLoading && needsOnboarding) {
      router.replace('/onboarding' as never)
    }
  }, [isLoading, needsOnboarding])

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
      tabBar={(props) => <LiquidGlassTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Inicio' }} />
      <Tabs.Screen name="nutrition" options={{ title: 'Nutrición' }} />
      <Tabs.Screen name="recipes" options={{ title: 'Recetas' }} />
      <Tabs.Screen name="groceries" options={{ title: 'Compra' }} />
    </Tabs>
  )
}
