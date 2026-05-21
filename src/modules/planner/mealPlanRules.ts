import type { Recipe } from '../../types/recipes'
import type { FamilyMember, SchoolMenuEntry } from '../../types/profiles'

// Pure helpers used by the meal-plan generator. Kept free of LLM/DB imports
// so they can be unit-tested without booting the React Native runtime.

const MIN_AVOID_TOKEN_LENGTH = 4

const STOP_WORDS = new Set([
  'con', 'sin', 'de', 'del', 'la', 'el', 'los', 'las', 'al', 'a', 'en', 'y', 'o', 'u',
  'and', 'or', 'with', 'without', 'the', 'of', 'in', 'on', 'for', 'to', 'from',
])

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function normalizeForMatch(s: string): string[] {
  return stripDiacritics(s.toLowerCase())
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= MIN_AVOID_TOKEN_LENGTH && !STOP_WORDS.has(t))
}

/** True when the recipe's name shares any meaningful token with the avoid list. */
export function recipeConflictsWith(recipe: Recipe, avoid: string[] | undefined): boolean {
  if (!avoid || avoid.length === 0) return false
  const avoidTokens = new Set(avoid.flatMap(normalizeForMatch))
  if (avoidTokens.size === 0) return false
  const nameTokens = [
    ...normalizeForMatch(recipe.name),
    ...(recipe.nameEs ? normalizeForMatch(recipe.nameEs) : []),
  ]
  return nameTokens.some((t) => avoidTokens.has(t))
}

export interface SchoolMenuCoverage {
  /** Member id. Only school-age members appear here. */
  memberId: string
  /** All school-menu entries for that member; lookups are by date. */
  entries: Array<Omit<SchoolMenuEntry, 'meal'>>
}

export interface DayDecisions {
  /** True when every family member has a school-menu entry for that day. */
  lunchSkipByDay: boolean[]
  /** Keywords each day's dinner should avoid (from minors' lunches at school). */
  dinnerAvoidByDay: string[][]
}

/**
 * Given the family roster, each school-age member's school-menu entries and
 * the 7 generated dates, returns:
 *
 *  - `lunchSkipByDay[i]`: whether the family lunch slot should be left empty
 *    for day `i`. True only when EVERY family member is covered by a school-
 *    menu entry that day (e.g. a single-minor or all-minor family). Adults
 *    are never "covered", so a mixed family always gets a lunch suggestion.
 *  - `dinnerAvoidByDay[i]`: courses + ingredients the dinner picker should
 *    avoid for day `i`, to prevent dinner from echoing what the minors had
 *    at school for lunch.
 */
export function computeDayDecisions(
  profiles: FamilyMember[],
  coverage: SchoolMenuCoverage[],
  dates: string[]
): DayDecisions {
  const familySize = profiles.length
  const lunchSkipByDay: boolean[] = []
  const dinnerAvoidByDay: string[][] = []
  for (const date of dates) {
    const covered = new Set<string>()
    const avoid: string[] = []
    for (const { memberId, entries } of coverage) {
      const entry = entries.find((e) => e.date === date)
      if (!entry) continue
      covered.add(memberId)
      if (entry.firstCourse) avoid.push(entry.firstCourse)
      if (entry.secondCourse) avoid.push(entry.secondCourse)
      avoid.push(...entry.extractedIngredients)
    }
    lunchSkipByDay.push(familySize > 0 && covered.size === familySize)
    dinnerAvoidByDay.push(avoid)
  }
  return { lunchSkipByDay, dinnerAvoidByDay }
}
