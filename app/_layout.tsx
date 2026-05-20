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
import { LogBox, StyleSheet, View } from 'react-native'
import { logger } from '../src/utils/logger'

// Cosmetic: react-native-executorch warns when HuggingFace's CDN serves the
// tokenizer JSON files without a Content-Length header (= can't compute a
// download progress %). Files download fine; the warnings are noise.
LogBox.ignoreLogs([/\[React Native ExecuTorch\] No content-length header/])
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ProfilesProvider } from '../src/modules/profiles/ProfilesContext'
import { ConsentProvider } from '../src/modules/consent/ConsentContext'
import { SelectedProfileProvider } from '../src/modules/profiles/SelectedProfileContext'
import { HeaderProfileAvatar } from '../src/components/layout/HeaderProfileAvatar'
import { PlannerProvider } from '../src/modules/planner/PlannerContext'
import { GroceriesProvider } from '../src/modules/groceries/GroceriesContext'
import { InventoryProvider } from '../src/modules/inventory/InventoryContext'
import { HealthProvider } from '../src/modules/health/HealthContext'
import { AIEngineProvider } from '../src/modules/ai-engine/AIContext'
import { AIAssistantHost } from '../src/components/layout/AIAssistantHost'
import { LLMLoadingBar } from '../src/components/layout/LLMLoadingBar'
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext'
import { runMigrations } from '../src/db/database'
import { t } from '../src/i18n'
import { seedRecipesIfNeeded } from '../src/modules/recipes/seedRecipes'
import { isSynced, syncRecipes } from '../src/modules/recipes/syncRecipes'
import { ensureModelAvailable, isModelDownloaded } from '../src/services/onDeviceLlm'
import { isAISupportedOnThisDevice } from '../src/services/deviceCapabilities'
import { ensureEmbeddingsAvailable } from '../src/services/embeddings'
import { ensureKey as ensureEncryptionKey } from '../src/services/encryption'
import { migrateProfilesToEncryptedFields } from '../src/modules/profiles/profileStorage'
import { migratePlaintextDocumentsToEncrypted } from '../src/services/secureFileStore'
import { runRetentionSweep } from '../src/services/dataRetention'
import { notifyDownloadStarted, notifyModelReady } from '../src/services/aiNotifications'
import { DecryptFailureBanner } from '../src/components/layout/DecryptFailureBanner'
import Constants from 'expo-constants'

function AppShell() {
  const { isDark, colors } = useTheme()

  return (
    <ProfilesProvider>
      <ConsentProvider>
      <SelectedProfileProvider>
      <GroceriesProvider>
      <PlannerProvider>
      <InventoryProvider>
      <HealthProvider>
      <AIEngineProvider>
      <AIAssistantHost>
        <LLMLoadingBar />
        <DecryptFailureBanner appVersion={Constants.expoConfig?.version ?? '1.0.0'} />
        <Stack>
          <Stack.Screen
            name="(tabs)"
            options={{
              headerShown: false,
              // React Navigation's default screen background is pure white;
              // letting it show through would render as a horizontal white
              // band refracted through the floating Liquid Glass bar.
              contentStyle: { backgroundColor: colors.background },
            }}
          />
          <Stack.Screen
            name="scanner"
            options={{ headerShown: false, presentation: 'fullScreenModal' }}
          />
          <Stack.Screen
            name="settings"
            options={{
              title: t.settings.title,
              headerBackTitle: t.app.backTitle,
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
              headerRight: () => <HeaderProfileAvatar />,
            }}
          />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen
            name="audit-log"
            options={{
              title: t.auditLog.title,
              headerBackTitle: t.app.backTitle,
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
            }}
          />
          {/* Dev-only AI behavioural eval. The screen guards itself with
              `__DEV__`; the route is inert in a release build. */}
          <Stack.Screen
            name="dev/ai-eval"
            options={{
              title: 'AI Eval (dev)',
              headerBackTitle: t.app.backTitle,
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
            }}
          />
          <Stack.Screen
            name="legal/privacy"
            options={{
              title: t.privacyPolicy.headerTitle,
              headerBackTitle: t.app.backTitle,
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
            }}
          />
          <Stack.Screen
            name="recipe/[id]"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="profile/[id]"
            options={{
              headerTransparent: true,
              headerTitle: '',
              headerBackTitle: '',
              headerTintColor: colors.text,
            }}
          />
        </Stack>
        <StatusBar style={isDark ? 'light' : 'dark'} />
      </AIAssistantHost>
      </AIEngineProvider>
      </HealthProvider>
      </InventoryProvider>
      </PlannerProvider>
      </GroceriesProvider>
      </SelectedProfileProvider>
      </ConsentProvider>
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
        // Encryption key MUST be ready before any profile/memory read so the
        // decrypt path has the key it needs. ensureKey is idempotent.
        await ensureEncryptionKey()
        await runMigrations()
        // Idempotent boot job that re-serialises any plaintext profile
        // payload (pre-Sprint-2 installs) through the encrypted-fields
        // layout. Cheap no-op for installs that are already migrated.
        await migrateProfilesToEncryptedFields()
        // Same pattern for clinical PDFs on disk: pre-Sprint-2 uploads
        // landed as plaintext `.pdf`; this rewrites them as `.pdf.enc`
        // and removes the plaintext copy. No-op once every file has a
        // `.enc` sibling.
        await migratePlaintextDocumentsToEncrypted()
        // Daily retention sweep — GDPR Art. 5.1.e (storage limitation).
        // Skips itself if already executed today, so safe to call on
        // every cold start.
        runRetentionSweep().catch((e) =>
          logger.warn('[Init] retention sweep failed', { err: e }),
        )
        await seedRecipesIfNeeded()

        // Download Edamam Mediterranean recipes in the background if the
        // DB is not yet fully synced (new install or sync version bumped).
        isSynced().then((synced) => {
          if (!synced) {
            logger.info('[Init] Starting background Edamam sync...')
            syncRecipes().catch((e) =>
              logger.warn('[Init] Background recipe sync failed:', e)
            )
          }
        })
      } catch (e) {
        logger.error('[Init] Error durante la inicialización:', e)
      }

      // Bring up the local LLM in the background — the on-device assistant is
      // a core, mandatory part of the app, but we don't block the UI on its
      // ~800MB first download. The user can proceed with onboarding/profiles
      // and is notified when the model is ready.
      // Devices with <6 GB RAM skip the download entirely: Qwen 3 1.7B Q
      // OOMs on load and the resulting crash burns ~1 GB of mobile data for
      // nothing. The user keeps a fully-functional scanner / planner / pantry
      // experience without the AI assistant.
      isAISupportedOnThisDevice()
        .then(async (supported) => {
          if (!supported) return
          const alreadyDownloaded = await isModelDownloaded()
          if (!alreadyDownloaded) await notifyDownloadStarted()
          const loaded = await ensureModelAvailable()
          if (loaded && !alreadyDownloaded) await notifyModelReady()
        })
        .catch((e) => logger.warn('[Init] LLM init failed:', e))

      // Embeddings model (~28MB) for PDF retrieval. Smaller than the LLM,
      // also non-blocking; PDFs uploaded before it loads will fail to index
      // and silently skip retrieval until the next upload.
      ensureEmbeddingsAvailable().catch((e) =>
        logger.warn('[Init] Embeddings init failed:', e)
      )

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
