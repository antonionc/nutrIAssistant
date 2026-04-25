import {
  Poppins_300Light,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from '@expo-google-fonts/poppins'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { ImageBackground, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ProfilesProvider } from '../src/modules/profiles/ProfilesContext'
import { PlannerProvider } from '../src/modules/planner/PlannerContext'
import { GroceriesProvider } from '../src/modules/groceries/GroceriesContext'
import { AIEngineProvider } from '../src/modules/ai-engine/AIContext'
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext'
import { runMigrations } from '../src/db/database'
import { seedRecipesIfNeeded } from '../src/modules/recipes/seedRecipes'
import { isSynced, syncRecipes, enrichSeedRecipeImages } from '../src/modules/recipes/syncRecipes'
import { ensureModelAvailable } from '../src/services/onDeviceLlm'
import { Colors, Typography } from '../src/theme'

function AppShell() {
  const { isDark } = useTheme()

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
            options={{ title: 'Ajustes', headerBackTitle: 'Volver', headerStyle: { backgroundColor: isDark ? '#1a1a1a' : '#FAFAF5' }, headerTintColor: isDark ? '#FAFAF5' : '#2D2D2D' }}
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
  const [llmPhase, setLlmPhase] = useState<'idle' | 'downloading' | 'loading' | 'ready' | 'error'>('idle')
  const [llmProgress, setLlmProgress] = useState(0)

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

        // Download TheMealDB recipes in the background if the DB is not yet
        // fully synced (new install or sync version bumped).
        isSynced().then((synced) => {
          if (!synced) {
            console.log('[Init] Starting background TheMealDB sync...')
            syncRecipes().catch((e) =>
              console.warn('[Init] Background recipe sync failed:', e)
            )
          }
        })

        // Silently enrich seed recipes that have no image by searching
        // TheMealDB — runs in the background, never blocks startup.
        enrichSeedRecipeImages().catch(() => {/* silent */})
      } catch (e) {
        console.error('[Init] Error durante la inicialización:', e)
      }

      try {
        const loaded = await ensureModelAvailable((phase, progress) => {
          setLlmPhase(phase)
          if (progress !== undefined) setLlmProgress(progress)
        })
        setLlmPhase(loaded ? 'ready' : 'idle')
      } catch (e) {
        console.warn('[Init] LLM init failed, using Claude API fallback:', e)
        setLlmPhase('idle')
      }

      setDbReady(true)
    }
    initApp()
  }, [])

  if (!fontsLoaded || !dbReady) {
    const statusText =
      llmPhase === 'downloading'
        ? `Descargando modelo IA… ${Math.round(llmProgress * 100)}%`
        : llmPhase === 'loading'
        ? 'Cargando modelo en memoria…'
        : 'Iniciando nutrIAssistant…'

    return (
      <ImageBackground
        source={require('../assets/images/splash-wallpaper.jpg')}
        style={styles.splash}
        resizeMode="cover"
      >
        <View style={styles.splashFooter}>
          <Text style={styles.splashStatus}>{statusText}</Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: llmPhase === 'downloading'
                    ? `${Math.round(llmProgress * 100)}%`
                    : llmPhase === 'loading' ? '95%' : '10%',
                },
              ]}
            />
          </View>
        </View>
      </ImageBackground>
    )
  }

  return (
    <ThemeProvider>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <BottomSheetModalProvider>
            <AppShell />
          </BottomSheetModalProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ThemeProvider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  splash: {
    flex: 1,
  },
  splashFooter: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 10,
  },
  splashStatus: {
    ...Typography.caption,
    color: Colors.warmCharcoal,
    opacity: 0.55,
  },
  progressTrack: {
    width: 180,
    height: 3,
    borderRadius: 2,
    backgroundColor: `${Colors.healthGreen}30`,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: Colors.healthGreen,
  },
})
