import { getLocales } from 'expo-localization'

// Single source of truth for the device's *language* used by AI prompts,
// LLM system instructions, voice/TTS locale tags, and other per-device
// localization decisions outside React components.
//
// We collapse to two buckets — 'en' or 'es' — because that's what the i18n
// table supports. Anything else falls through to 'es' to match the i18n
// fallback in src/i18n/index.ts.
export type AppLanguage = 'en' | 'es'

export function currentLang(): AppLanguage {
  const code = getLocales()[0]?.languageCode ?? 'es'
  return code === 'en' ? 'en' : 'es'
}

// BCP-47 voice/TTS tag matching the device language. Used by Voice.start()
// and Speech.speak() so speech recognition and synthesis match the UI.
export function deviceVoiceLocale(): string {
  return currentLang() === 'en' ? 'en-US' : 'es-ES'
}

// Native-language label for the language itself, useful inside LLM prompts
// (e.g. "Always respond in {lang}").
export function languageNameInLanguage(): string {
  return currentLang() === 'en' ? 'English' : 'español de España'
}
