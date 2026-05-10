import { classify, REFUSAL_MESSAGE, getRefusalMessage } from '../../services/topicGate'

describe('topicGate.classify', () => {
  describe('in-scope queries', () => {
    const inScope = [
      '¿Qué puedo cocinar esta noche?',
      '¿Cuántas calorías tiene un aguacate?',
      'Necesito una receta sin gluten',
      '¿Es bueno el pescado para la presión?',
      'Añade tomates a la lista de la compra',
      'Hazme un menú vegetariano para la semana',
      'Tengo el colesterol alto, ¿qué evito?',
      '¿Qué hay en mi despensa?',
      'Mi hijo es celíaco, ¿qué desayuno le doy?',
      '¿El café engorda?',
      'cocinar', // single word, food-related
    ]
    it.each(inScope)('classifies %p as "in"', (q) => {
      expect(classify(q)).toBe('in')
    })
  })

  describe('out-of-scope queries', () => {
    const outOfScope = [
      'Escríbeme una función JavaScript que ordene un array',
      '¿Quién ganó el Mundial de fútbol?',
      'Háblame de la política de Trump',
      'Recomiéndame una serie de Netflix',
      '¿Cómo invierto en cripto?',
      '¿Qué tiempo hace hoy?',
      'Explícame el algoritmo de Dijkstra',
    ]
    it.each(outOfScope)('classifies %p as "out"', (q) => {
      expect(classify(q)).toBe('out')
    })
  })

  describe('priority: in-scope wins over off-scope markers', () => {
    it('treats "calorías de programar" as in-scope (calorías matches first)', () => {
      // Edge case: keyword precedence is "in" before "out".
      expect(classify('¿Cuántas calorías quemo programando?')).toBe('in')
    })
  })

  describe('ambiguous queries', () => {
    it('classifies a generic greeting as ambiguous', () => {
      expect(classify('Hola')).toBe('ambiguous')
    })
    it('classifies a vague question as ambiguous', () => {
      expect(classify('¿Tú qué piensas?')).toBe('ambiguous')
    })
  })

  it('exposes a non-empty Spanish refusal string (legacy constant)', () => {
    expect(REFUSAL_MESSAGE).toMatch(/NutriBot/)
    expect(REFUSAL_MESSAGE.length).toBeGreaterThan(40)
  })

  it('getRefusalMessage returns a localized string mentioning NutriBot', () => {
    const msg = getRefusalMessage()
    expect(msg).toMatch(/NutriBot/)
    expect(msg.length).toBeGreaterThan(40)
  })
})
