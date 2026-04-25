import { getLocales } from 'expo-localization'
import { EN } from './en'
import { ES } from './es'

// EN is the canonical shape. ES has the same structure but different string
// literals, so TypeScript can't infer structural equality — we cast once here.
export type Translations = typeof EN
type AnyTranslations = Translations | typeof ES

const SUPPORTED: Partial<Record<string, AnyTranslations>> = { en: EN, es: ES }

function resolveTranslations(): Translations {
  const lang = getLocales()[0]?.languageCode ?? 'es'
  return (SUPPORTED[lang] ?? ES) as Translations
}

// Singleton — locale doesn't change at runtime
const translations = resolveTranslations()

export function useTranslation(): Translations {
  return translations
}

// For use outside React components
export { translations as t }
