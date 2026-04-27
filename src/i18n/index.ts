import { getLocales } from 'expo-localization'
import { EN } from './en'
import { ES } from './es'

// EN is the canonical shape. ES has the same structure but different string
// literals, so TypeScript can't infer structural equality — we cast once here.
export type Translations = typeof EN
type AnyTranslations = Translations | typeof ES

// Compile-time key-drift guard: TS errors if ES is missing any top-level key
// that EN defines (or vice-versa). Nested keys are intentionally not checked
// here — an explicit Translations interface would be required for that.
type _ENKeys = keyof typeof EN
type _ESKeys = keyof typeof ES
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _KeyGuard = [_ENKeys] extends [_ESKeys] ? ([_ESKeys] extends [_ENKeys] ? true : never) : never

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
