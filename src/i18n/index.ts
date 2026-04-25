import { getLocales } from 'expo-localization'
import { EN } from './en'
import { ES } from './es'

export type Translations = typeof EN

const SUPPORTED: Record<string, Translations> = {
  en: EN,
  es: ES as unknown as Translations,
}

function resolveTranslations(): Translations {
  const lang = getLocales()[0]?.languageCode ?? 'es'
  return SUPPORTED[lang] ?? ES as unknown as Translations
}

// Singleton — locale doesn't change at runtime
const translations = resolveTranslations()

export function useTranslation(): Translations {
  return translations
}

// For use outside React components
export { translations as t }
