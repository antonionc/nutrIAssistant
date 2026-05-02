import {
  Poppins_300Light,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from '@expo-google-fonts/poppins'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ProfilesProvider } from '../src/modules/profiles/ProfilesContext'
import { PlannerProvider } from '../src/modules/planner/PlannerContext'
import { GroceriesProvider } from '../src/modules/groceries/GroceriesContext'
import { AIEngineProvider } from '../src/modules/ai-engine/AIContext'
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext'
import { runMigrations } from '../src/db/database'
import { seedRecipesIfNeeded } from '../src/modules/recipes/seedRecipes'
import { isSynced, syncRecipes } from '../src/modules/recipes/syncRecipes'
import { ensureModelAvailable } from '../src/services/onDeviceLlm'

function AppShell() {
  const { isDark, colors } = useTheme()

  return (
    <ProfilesProvider>
      <GroceriesProvider>
      <PlannerProvider>
      <AIEngineProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="scanner"
            options={{ headerShown: false, presentation: 'fullScreenModal' }}
          />
          <Stack.Screen
            name="settings"
            options={{ title: 'Ajustes', headerBackTitle: 'Volver', headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}
          />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen
            name="recipe/[id]"
            options={{ headerShown: false }}
          />
        </Stack>
        <StatusBar style={isDark ? 'light' : 'dark'} />
      </AIEngineProvider>
      </PlannerProvider>
      </GroceriesProvider>
    </ProfilesProvider>
  )
}

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false)

  const [fontsLoaded] = useFonts({
    Poppins_300Light,
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  })

  useEffect(() => {
    async function initApp() {
      try {
        await runMigrations()
        await seedRecipesIfNeeded()

        // Download FatSecret Mediterranean recipes in the background if the
        // DB is not yet fully synced (new install or sync version bumped).
        isSynced().then((synced) => {
          if (!synced) {
            console.log('[Init] Starting background FatSecret sync...')
            syncRecipes().catch((e) =>
              console.warn('[Init] Background recipe sync failed:', e)
            )
          }
        })
      } catch (e) {
        console.error('[Init] Error durante la inicialización:', e)
      }

      try {
        await ensureModelAvailable()
      } catch (e) {
        console.warn('[Init] LLM init failed, using Claude API fallback:', e)
      }

      setDbReady(true)
    }
    initApp()
  }, [])

  if (!fontsLoaded || !dbReady) return null

  return (
    <ThemeProvider>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <AppShell />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ThemeProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
