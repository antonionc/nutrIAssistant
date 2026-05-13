// Single source of truth for every AsyncStorage key the app uses.
//
// Adding a new key here REQUIRES a decision: does it need to be wiped on
// GDPR Art. 17 erasure? If yes, add it to APP_ERASABLE_KEYS at the bottom.
// If no (e.g. the master key in Keychain), keep it out — but document why.
//
// Why centralise this:
//   - Pre-centralisation, dataErasure.ts had its own hand-typed list that
//     drifted out of sync with the call sites (7 of 10 keys were wrong,
//     6 keys were missing). Now there's a single place that the eraser,
//     the rotation flow, and the call sites all reference.
//   - The `as const` makes the keys narrow string literals so a typo in
//     a consumer fails at compile time.

export const SK = {
  // ── Profile + family ────────────────────────────────────────────────
  profiles: 'family_profiles',
  familyName: 'family_name',
  appInitialized: 'app_initialized',

  // ── Consent + capability flags ──────────────────────────────────────
  consent: 'nutri_consent_v1',
  aiUnsupported: 'nutri_ai_unsupported',
  retentionLastSweep: 'nutri_retention_last_sweep',
  themePreference: 'theme_preference',

  // ── Health provider selection ───────────────────────────────────────
  healthActiveProvider: 'health_active_provider',

  // ── Recipe sync + sources ───────────────────────────────────────────
  recipesSynced: 'recipes_synced',
  recipesSyncVersion: 'recipes_sync_version',
  recipesSyncDate: 'recipes_sync_date',
  seedRecipesLoaded: 'seed_recipes_loaded',
  recipeSourcesConfig: 'recipe_sources_config',

  // ── Provider quota caches ───────────────────────────────────────────
  spoonacularQuotaCache: 'sp_quota_cache_v2',

  // ── On-device model flags ───────────────────────────────────────────
  modelFirstLoaded: 'on_device_model_first_loaded_qwen3_1_7b_q_bff',
  embeddingsFirstLoaded: 'on_device_embeddings_first_loaded',
} as const

// Every key the GDPR Art. 17 erasure handler MUST wipe. Excludes:
//   - the master key in Keychain (handled separately by SecureStore)
//   - migrations table (in SQLite, recreated on next boot)
//
// Adding a key here is the only safe way to make `eraseAllUserData()`
// pick it up — dataErasure.ts reads this constant directly.
export const APP_ERASABLE_ASYNC_STORAGE_KEYS = [
  SK.profiles,
  SK.familyName,
  SK.appInitialized,
  SK.consent,
  SK.aiUnsupported,
  SK.retentionLastSweep,
  SK.themePreference,
  SK.healthActiveProvider,
  SK.recipesSynced,
  SK.recipesSyncVersion,
  SK.recipesSyncDate,
  SK.seedRecipesLoaded,
  SK.recipeSourcesConfig,
  SK.spoonacularQuotaCache,
  SK.modelFirstLoaded,
  SK.embeddingsFirstLoaded,
] as const
