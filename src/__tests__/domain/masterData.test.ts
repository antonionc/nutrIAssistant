import { EU_14_ALLERGENS, CONDITIONS_LIST } from '../../domain/masterData'
import { ALLERGEN_KEYWORDS } from '../../seed/allergen-rules'
import { EN } from '../../i18n/en'
import { ES } from '../../i18n/es'

describe('domain/masterData — coherence between catalogs and i18n', () => {
  it('every allergen in EU_14_ALLERGENS has a keyword rule', () => {
    for (const a of EU_14_ALLERGENS) {
      expect(ALLERGEN_KEYWORDS[a]).toBeDefined()
      expect(ALLERGEN_KEYWORDS[a].length).toBeGreaterThan(0)
    }
  })

  it('every allergen has an i18n label in both EN and ES', () => {
    for (const a of EU_14_ALLERGENS) {
      const en = (EN.allergens as Record<string, string>)[a]
      const es = (ES.allergens as Record<string, string>)[a]
      expect(en).toBeDefined()
      expect(en).toBeTruthy()
      expect(es).toBeDefined()
      expect(es).toBeTruthy()
    }
  })

  it('every condition ID has an i18n label in both EN and ES', () => {
    for (const c of CONDITIONS_LIST) {
      const en = (EN.settings.conditions as Record<string, string>)[c]
      const es = (ES.settings.conditions as Record<string, string>)[c]
      expect(en).toBeDefined()
      expect(en).toBeTruthy()
      expect(es).toBeDefined()
      expect(es).toBeTruthy()
    }
  })
})
