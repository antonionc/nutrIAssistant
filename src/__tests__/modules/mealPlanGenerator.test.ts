import {
  normalizeForMatch,
  recipeConflictsWith,
  computeDayDecisions,
  type SchoolMenuCoverage,
} from '../../modules/planner/mealPlanRules'
import type { Recipe } from '../../types/recipes'
import type { FamilyMember, SchoolMenuEntry } from '../../types/profiles'

function makeMember(id: string, overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id,
    name: id,
    role: 'father',
    dateOfBirth: '1990-01-01',
    weight: 70,
    height: 175,
    allergies: [],
    conditions: [],
    dietPreference: 'none',
    isSchoolAge: false,
    favoriteRecipeIds: [],
    documents: [],
    isSuperUser: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeEntry(
  date: string,
  overrides: Partial<Omit<SchoolMenuEntry, 'meal'>> = {}
): Omit<SchoolMenuEntry, 'meal'> {
  return {
    id: `entry-${date}`,
    date,
    childId: 'child',
    description: '',
    extractedIngredients: [],
    extractedAllergens: [],
    ...overrides,
  }
}

function makeRecipe(name: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    category: 'dinner',
    cuisine: 'mediterranean',
    instructions: [],
    ingredients: [],
    prepTime: 10,
    cookTime: 20,
    servings: 2,
    nutritionalInfo: { calories: 400, protein: 20, carbs: 40, fat: 15 },
    allergens: [],
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('normalizeForMatch', () => {
  it('strips diacritics, lowercases, and drops short and stop tokens', () => {
    expect(normalizeForMatch('Lentejas con chorizo')).toEqual(['lentejas', 'chorizo'])
  })

  it('handles English stopwords and minimum token length', () => {
    expect(normalizeForMatch('Pasta with tomato')).toEqual(['pasta', 'tomato'])
  })

  it('returns an empty array for whitespace or punctuation-only input', () => {
    expect(normalizeForMatch('  ,. ')).toEqual([])
  })
})

describe('recipeConflictsWith', () => {
  it('returns false when no avoid list is provided', () => {
    expect(recipeConflictsWith(makeRecipe('Salmon Bowl'), undefined)).toBe(false)
    expect(recipeConflictsWith(makeRecipe('Salmon Bowl'), [])).toBe(false)
  })

  it('detects a conflict when the recipe name shares a meaningful token', () => {
    // Kids ate lentejas at school — a lentil-based dinner should be flagged.
    expect(
      recipeConflictsWith(makeRecipe('Lentejas estofadas'), ['Lentejas con verduras'])
    ).toBe(true)
  })

  it('ignores stopwords and short tokens that would otherwise create false positives', () => {
    // "con" appears in both but is a stopword; "pollo" vs "salmon" don't match.
    expect(
      recipeConflictsWith(makeRecipe('Salmón con limón'), ['Pollo con arroz'])
    ).toBe(false)
  })

  it('matches across diacritics and case', () => {
    expect(
      recipeConflictsWith(makeRecipe('Salmón al horno'), ['salmon a la plancha'])
    ).toBe(true)
  })

  it('checks both English and Spanish recipe names when present', () => {
    const recipe = makeRecipe('Roasted Chicken', { nameEs: 'Pollo asado' })
    expect(recipeConflictsWith(recipe, ['Pollo con verduras'])).toBe(true)
  })
})

describe('computeDayDecisions', () => {
  const DATES = [
    '2026-05-25', // Mon — school day in coverage
    '2026-05-26', // Tue — school day in coverage
    '2026-05-30', // Sat — weekend, no school menu
  ]

  it('keeps lunch on mixed-family school days (adult + minor with menu)', () => {
    const adult = makeMember('adult-1')
    const minor = makeMember('minor-1', { isSchoolAge: true, dateOfBirth: '2018-01-01' })
    const coverage: SchoolMenuCoverage[] = [
      {
        memberId: minor.id,
        entries: [
          makeEntry('2026-05-25', { firstCourse: 'Lentejas con verduras' }),
          makeEntry('2026-05-26', { firstCourse: 'Macarrones' }),
        ],
      },
    ]
    const { lunchSkipByDay } = computeDayDecisions([adult, minor], coverage, DATES)
    // Adult is never covered, so lunch is never skipped for the family.
    expect(lunchSkipByDay).toEqual([false, false, false])
  })

  it('skips lunch only when every family member has a school-menu entry that day', () => {
    const minorA = makeMember('m-a', { isSchoolAge: true, dateOfBirth: '2018-01-01' })
    const minorB = makeMember('m-b', { isSchoolAge: true, dateOfBirth: '2019-01-01' })
    const coverage: SchoolMenuCoverage[] = [
      {
        memberId: minorA.id,
        entries: [makeEntry('2026-05-25'), makeEntry('2026-05-26')],
      },
      {
        // Minor B is sick on Monday — no school menu that day.
        memberId: minorB.id,
        entries: [makeEntry('2026-05-26')],
      },
    ]
    const { lunchSkipByDay } = computeDayDecisions([minorA, minorB], coverage, DATES)
    // Mon: only A covered → lunch kept. Tue: both → skipped. Sat: nobody → kept.
    expect(lunchSkipByDay).toEqual([false, true, false])
  })

  it('returns school-menu keywords as the dinner-avoid list per day', () => {
    const minor = makeMember('m-1', { isSchoolAge: true, dateOfBirth: '2018-01-01' })
    const coverage: SchoolMenuCoverage[] = [
      {
        memberId: minor.id,
        entries: [
          makeEntry('2026-05-25', {
            firstCourse: 'Lentejas con verduras',
            secondCourse: 'Pollo asado',
            extractedIngredients: ['lentejas', 'pollo'],
          }),
        ],
      },
    ]
    const { dinnerAvoidByDay } = computeDayDecisions([minor], coverage, DATES)
    expect(dinnerAvoidByDay[0]).toContain('Lentejas con verduras')
    expect(dinnerAvoidByDay[0]).toContain('Pollo asado')
    expect(dinnerAvoidByDay[0]).toContain('lentejas')
    expect(dinnerAvoidByDay[1]).toEqual([])
    expect(dinnerAvoidByDay[2]).toEqual([])
  })

  it('treats an empty family roster as "no skip"', () => {
    const { lunchSkipByDay } = computeDayDecisions([], [], DATES)
    expect(lunchSkipByDay).toEqual([false, false, false])
  })
})
