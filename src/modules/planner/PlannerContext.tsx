import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { MealPlan } from '../../types/planner'
import { Recipe } from '../../types/recipes'
import { SchoolMenuEntry } from '../../types/profiles'
import {
  upsertMealPlan,
  getMealPlansForRange,
  toggleLockPlan,
  saveSchoolMenuEntry,
  getSchoolMenuEntries,
  deleteSchoolMenuEntriesForChild,
  getSchoolMenuChildIds,
} from './plannerDB'
import { extractPdfText, extractPdfTextLines } from '../../../modules/expo-pdf-text'
import { generateOnDevice, getLLMStatus } from '../../services/onDeviceLlm'
import { InventoryLite } from '../../services/prompts/system'
import {
  buildSchoolMenuExtractionPrompt,
  buildSchoolMenuExtractionPromptSimple,
} from '../../services/prompts/schoolMenuExtraction'
import {
  parseSchoolMenuResponse,
  normalizeSchoolMenuEntry,
  deterministicSchoolMenuParse,
  parseSchoolMenuViaGeometry,
  extractDocumentMonthAnchor,
  validateParsedEntries,
  SCHOOL_MENU_NO_DATA_SENTINEL,
  type MenuMonthAnchor,
} from '../../services/schoolMenuParser'
import { t } from '../../i18n'
import { useProfiles } from '../profiles/ProfilesContext'
import { selectWeekRecipes, computeDayDecisions } from './mealPlanGenerator'
import { logger } from '../../utils/logger'

function getWeekDates(startDate?: string): string[] {
  const start = startDate ? new Date(startDate) : new Date()
  start.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  })
}

type MealSlot = 'breakfast' | 'lunch' | 'dinner'

export type SchoolMenuUploadStage =
  | 'llm_not_ready'
  | 'pdf_empty'
  | 'pdf_extract'
  | 'llm_parse'
  | 'llm_generate'

export interface SchoolMenuUploadResult {
  entryCount: number
  firstDate: string | null
  lastDate: string | null
  /** True when the deterministic regex parser produced the result. */
  deterministic: boolean
}

/**
 * Output of `parseSchoolMenuForReview`: parsed entries + the month/year
 * anchor we resolved from the PDF, ready for the review UI to display and
 * edit. NOTHING has been written to the DB yet.
 */
export interface SchoolMenuParseResult {
  entries: Array<Omit<SchoolMenuEntry, 'id' | 'childId'>>
  anchor: MenuMonthAnchor
  /** True when the deterministic regex parser produced the result. */
  deterministic: boolean
}

export class SchoolMenuUploadError extends Error {
  stage: SchoolMenuUploadStage
  cause?: unknown
  constructor(stage: SchoolMenuUploadStage, cause?: unknown) {
    super(`School menu upload failed at stage: ${stage}`)
    this.name = 'SchoolMenuUploadError'
    this.stage = stage
    this.cause = cause
  }
}

interface PlannerContextValue {
  weekPlans: MealPlan[]
  isLoading: boolean
  isGenerating: boolean
  schoolMenuChildIds: string[]
  /**
   * Cache of school-menu entries grouped by child, keyed by date for
   * O(1) lookups from the Nutrition screen. Refreshed alongside
   * `schoolMenuChildIds` whenever the menu state changes.
   */
  schoolMenuByMember: Record<string, Record<string, Omit<SchoolMenuEntry, 'meal'>>>
  /** Returns the IDs of members whose school menu covers the given date. */
  getMembersAtSchoolOn: (date: string) => string[]
  loadWeek: (startDate?: string) => Promise<void>
  generateWeekPlan: (
    inventory: InventoryLite[],
    startDate?: string
  ) => Promise<void>
  setMealForDate: (date: string, mealType: MealSlot, recipe: Recipe) => Promise<void>
  removeMealFromDate: (date: string, mealType: MealSlot) => Promise<void>
  lockDay: (date: string) => Promise<void>
  uploadSchoolMenu: (pdfUri: string, childIds: string[]) => Promise<SchoolMenuUploadResult>
  /**
   * Parse a PDF into reviewable entries WITHOUT writing to the DB. The
   * caller (the review modal in `nutrition.tsx`) shows the entries for
   * editing, then calls `commitSchoolMenuEntries` to persist.
   */
  parseSchoolMenuForReview: (pdfUri: string) => Promise<SchoolMenuParseResult>
  /**
   * Write reviewed entries to the DB for the given child IDs. Wipes each
   * child's existing menu first (true replace semantics).
   */
  commitSchoolMenuEntries: (
    entries: Array<Omit<SchoolMenuEntry, 'id' | 'childId'>>,
    childIds: string[]
  ) => Promise<SchoolMenuUploadResult>
  refreshSchoolMenuState: () => Promise<void>
  getSchoolMenuEntries: typeof getSchoolMenuEntries
}

const PlannerContext = createContext<PlannerContextValue | null>(null)

export function PlannerProvider({ children }: { children: React.ReactNode }) {
  const { profiles } = useProfiles()
  const [weekPlans, setWeekPlans] = useState<MealPlan[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [schoolMenuChildIds, setSchoolMenuChildIds] = useState<string[]>([])
  const [schoolMenuByMember, setSchoolMenuByMember] = useState<
    Record<string, Record<string, Omit<SchoolMenuEntry, 'meal'>>>
  >({})

  const loadWeek = useCallback(async (startDate?: string) => {
    setIsLoading(true)
    const dates = getWeekDates(startDate)
    const plans = await getMealPlansForRange(dates[0], dates[6])
    setWeekPlans(plans)
    setIsLoading(false)
  }, [])

  const refreshSchoolMenuState = useCallback(async () => {
    const ids = await getSchoolMenuChildIds()
    setSchoolMenuChildIds(ids)
    const perMember: Record<string, Record<string, Omit<SchoolMenuEntry, 'meal'>>> = {}
    for (const id of ids) {
      const entries = await getSchoolMenuEntries(id)
      perMember[id] = Object.fromEntries(entries.map((e) => [e.date, e]))
    }
    setSchoolMenuByMember(perMember)
  }, [])

  const getMembersAtSchoolOn = useCallback(
    (date: string): string[] =>
      Object.entries(schoolMenuByMember)
        .filter(([, byDate]) => byDate[date] !== undefined)
        .map(([memberId]) => memberId),
    [schoolMenuByMember]
  )

  useEffect(() => {
    loadWeek()
    refreshSchoolMenuState()
  }, [loadWeek, refreshSchoolMenuState])

  /**
   * Generates a 7-day meal plan from locally-stored recipes. Uses the
   * on-device LLM when available to curate cuisine/variety; otherwise falls
   * back to a deterministic algorithmic picker that guarantees no
   * within-week repeats and rotates cuisines.
   *
   * School-menu handling:
   *  - Lunch is left undefined only when EVERY family member has a school
   *    menu entry that day (e.g., single-minor families, or all-minor
   *    families). When the family has at least one adult, lunch is always
   *    generated; the Nutrition screen labels which minors are eating at
   *    school so the user understands the recipe is for the rest.
   *  - Dinner avoids dishes/ingredients minors already had at school the
   *    same day, since cross-meal repetition is the most visible kind of
   *    "menu boredom".
   *
   * No cloud AI calls.
   */
  const generateWeekPlan = useCallback(
    async (_inventory: InventoryLite[], startDate?: string) => {
      setIsGenerating(true)
      try {
        const dates = getWeekDates(startDate)

        const schoolAgeIds = profiles.filter((p) => p.isSchoolAge).map((p) => p.id)
        const coverage = await Promise.all(
          schoolAgeIds.map(async (memberId) => ({
            memberId,
            entries: await getSchoolMenuEntries(memberId),
          }))
        )
        const { lunchSkipByDay, dinnerAvoidByDay } = computeDayDecisions(
          profiles,
          coverage,
          dates
        )

        const { breakfasts, lunches, dinners } = await selectWeekRecipes(profiles, {
          dinnerAvoidByDay,
        })

        const now = new Date().toISOString()
        const newPlans: MealPlan[] = []

        for (const [i, date] of dates.entries()) {
          const existing = weekPlans.find((p) => p.date === date)
          if (existing?.isLocked) {
            newPlans.push(existing)
            continue
          }

          const plan: MealPlan = {
            id: `plan-${date}`,
            date,
            meals: {
              breakfast: breakfasts[i],
              // Only blank the family lunch when every member has school
              // food that day — otherwise adults (and any uncovered minor)
              // still need a meal.
              lunch: lunchSkipByDay[i] ? undefined : lunches[i],
              dinner: dinners[i],
            },
            memberTargets: {},
            isLocked: false,
            generatedAt: now,
            updatedAt: now,
          }

          await upsertMealPlan(plan)
          newPlans.push(plan)
        }

        setWeekPlans(newPlans)
      } catch (error) {
        logger.error('[Planner] Generation failed:', error)
      } finally {
        setIsGenerating(false)
      }
    },
    [profiles, weekPlans]
  )

  const setMealForDate = useCallback(async (
    date: string,
    mealType: MealSlot,
    recipe: Recipe
  ) => {
    const now = new Date().toISOString()
    const existing = weekPlans.find((p) => p.date === date)
    const updatedPlan: MealPlan = {
      id: `plan-${date}`,
      date,
      meals: {
        breakfast: existing?.meals.breakfast,
        lunch: existing?.meals.lunch,
        dinner: existing?.meals.dinner,
        [mealType]: recipe,
      },
      memberTargets: existing?.memberTargets ?? {},
      isLocked: existing?.isLocked ?? false,
      generatedAt: existing?.generatedAt ?? now,
      updatedAt: now,
    }
    await upsertMealPlan(updatedPlan)
    await loadWeek()
  }, [weekPlans, loadWeek])

  const removeMealFromDate = useCallback(async (
    date: string,
    mealType: MealSlot
  ) => {
    const existing = weekPlans.find((p) => p.date === date)
    if (!existing) return
    const now = new Date().toISOString()
    const updatedPlan: MealPlan = {
      ...existing,
      meals: { ...existing.meals, [mealType]: undefined },
      updatedAt: now,
    }
    await upsertMealPlan(updatedPlan)
    await loadWeek()
  }, [weekPlans, loadWeek])

  const lockDay = useCallback(async (date: string) => {
    await toggleLockPlan(date)
    await loadWeek()
  }, [loadWeek])

  // School menu upload is a two-phase flow:
  //
  //   1. `parseSchoolMenuForReview(pdfUri)` extracts PDF text and runs the
  //      deterministic + LLM parse. NOTHING is written to the DB. The
  //      caller (the review modal in nutrition.tsx) shows the entries for
  //      manual correction.
  //   2. `commitSchoolMenuEntries(entries, childIds)` writes the reviewed
  //      entries per child, wiping previous menus first.
  //
  // `uploadSchoolMenu(pdfUri, childIds)` remains as a thin wrapper that
  // does both back-to-back, for callers that don't need the review step
  // (legacy paths + tests).
  const parseSchoolMenuForReview = useCallback(
    async (pdfUri: string): Promise<SchoolMenuParseResult> => {
      const status = await getLLMStatus()
      if (!status.isLoaded) {
        throw new SchoolMenuUploadError('llm_not_ready')
      }

      let pdfText: string
      try {
        pdfText = await extractPdfText(pdfUri)
      } catch (e) {
        throw new SchoolMenuUploadError('pdf_extract', e)
      }
      if (!pdfText.trim()) throw new SchoolMenuUploadError('pdf_empty')

      const refDate = new Date()
      const anchor = extractDocumentMonthAnchor(pdfText, refDate)
      let entries: Array<Omit<SchoolMenuEntry, 'id' | 'childId'>> = []
      let usedDeterministic = false

      // Layer 0 — geometric. iOS PDFKit can return per-line bounds via
      // `extractPdfTextLines`; when available, reconstruct the table by
      // column geometry. This is the only way to recover days whose markers
      // share a line with another column's content in PDFKit's flattened
      // reading order (real example: Balder May 2026 days 5 and 7).
      // Returns `[]` on Android (PdfBox positional extraction not yet wired)
      // — the next layers cover that case.
      let pdfLines: Awaited<ReturnType<typeof extractPdfTextLines>> = []
      try {
        pdfLines = await extractPdfTextLines(pdfUri)
      } catch {
        pdfLines = []
      }
      if (pdfLines.length > 0) {
        const geo = parseSchoolMenuViaGeometry(pdfLines, refDate)
        if (geo.entries.length >= 3) {
          const validation = validateParsedEntries(geo.entries, geo.anchor)
          const candidate = validation.ok ? validation.entries : geo.entries
          entries = candidate
          usedDeterministic = true
          logger.info('[Planner] School-menu parsed via geometry', {
            entryCount: entries.length,
            anchor: geo.anchor,
            validated: validation.ok,
          })
        }
      }

      // Layer 1 — text-based deterministic. Handles linear "LUNES 6 DE ABRIL
      // / Primer plato: …" PDFs AND tabular weekly grids parsed from page.string.
      // Kept declared at outer scope so the LLM fallback below can salvage from
      // it when the LLM parse normalises to zero entries.
      let deterministic: Array<Omit<SchoolMenuEntry, 'id' | 'childId'>> = []
      if (entries.length === 0) {
        deterministic = deterministicSchoolMenuParse(pdfText, refDate)
        if (deterministic.length >= 3) {
          const validation = validateParsedEntries(deterministic, anchor)
          if (validation.ok) {
            entries = validation.entries
            usedDeterministic = true
            logger.info('[Planner] School-menu parsed deterministically (text)', {
              entryCount: entries.length,
              anchor,
            })
          } else {
            logger.warn('[Planner] Deterministic text parse failed validation; falling back to LLM', {
              reason: validation.reason,
              entryCount: deterministic.length,
            })
          }
        }
      }

      // Layer 2 — LLM. Try the simple schema first; it's far more reliable
      // on Qwen 3 1.7B. Both prompts are pinned to the document anchor so
      // the model cannot drift across months.
      if (entries.length === 0) {
        const runLLM = async (prompt: string): Promise<string> => {
          try {
            return await generateOnDevice(
              `${prompt}\n\nPDF TEXT:\n${pdfText}`,
              '/no_think You extract structured school-menu data. Reply with ONLY a JSON array, starting with "[" and ending with "]". No markdown, no code fences, no commentary, no <think> tags.'
            )
          } catch (e) {
            throw new SchoolMenuUploadError('llm_generate', e)
          }
        }

        let response = await runLLM(buildSchoolMenuExtractionPromptSimple(anchor))
        let parsed = parseSchoolMenuResponse(response)

        if (!parsed) {
          logger.warn(
            '[Planner] Simple-schema school-menu parse failed; retrying with full schema',
            {
              responseLength: response.length,
              ...(__DEV__ ? { responseHead: response.slice(0, 300) } : {}),
            }
          )
          response = await runLLM(buildSchoolMenuExtractionPrompt(anchor))
          parsed = parseSchoolMenuResponse(response)
        }

        if (!parsed) {
          logger.error(
            '[Planner] School-menu retry still unparseable; aborting upload',
            {
              responseLength: response.length,
              ...(__DEV__ ? { responseHead: response.slice(0, 300) } : {}),
            }
          )
          throw new SchoolMenuUploadError('llm_parse')
        }

        const llmEntries = parsed
          .map(normalizeSchoolMenuEntry)
          .filter((e): e is NonNullable<typeof e> => e !== null)

        if (llmEntries.length === 0 && deterministic.length > 0) {
          // The LLM normalised down to nothing but the deterministic pass
          // had partial output. Surface that to the review UI — the user
          // can still edit/save it.
          entries = deterministic
          logger.info('[Planner] Falling back to deterministic parse after LLM normalisation produced 0 entries')
        } else if (llmEntries.length === 0) {
          logger.warn('[Planner] School-menu parse produced 0 valid entries after normalisation')
          throw new SchoolMenuUploadError('llm_parse')
        } else {
          // Best-effort validation. If validation fails we still surface
          // the entries to the review UI — the user can correct them.
          const validation = validateParsedEntries(llmEntries, anchor)
          entries = validation.ok ? validation.entries : llmEntries
          if (!validation.ok) {
            logger.warn('[Planner] LLM parse failed validation; sending raw entries to review', {
              reason: validation.reason,
              entryCount: llmEntries.length,
            })
          }
        }
      }

      // Translate the parser's no-data sentinel into a localized placeholder
      // for the review modal. Keeps the parser i18n-agnostic while giving
      // the user a clear label they can confirm, edit, or remove.
      const noDataLabel = t.nutrition.schoolMenuReviewNoDataPlaceholder
      entries = entries.map((e) =>
        e.description === SCHOOL_MENU_NO_DATA_SENTINEL
          ? { ...e, description: '', firstCourse: noDataLabel }
          : e
      )

      const sortedDates = entries.map((e) => e.date).sort()
      logger.info('[Planner] School-menu parse complete (review pending)', {
        entryCount: entries.length,
        firstDate: sortedDates[0] ?? null,
        lastDate: sortedDates[sortedDates.length - 1] ?? null,
        deterministic: usedDeterministic,
        anchor,
      })

      return { entries, anchor, deterministic: usedDeterministic }
    },
    []
  )

  const commitSchoolMenuEntries = useCallback(
    async (
      entries: Array<Omit<SchoolMenuEntry, 'id' | 'childId'>>,
      childIds: string[]
    ): Promise<SchoolMenuUploadResult> => {
      for (const childId of childIds) {
        await deleteSchoolMenuEntriesForChild(childId)
        for (const entry of entries) {
          await saveSchoolMenuEntry({
            id: `school-${entry.date}-${childId}`,
            date: entry.date,
            childId,
            description: entry.description,
            firstCourse: entry.firstCourse,
            secondCourse: entry.secondCourse,
            dessert: entry.dessert,
            extractedIngredients: entry.extractedIngredients,
            extractedAllergens: entry.extractedAllergens,
            nutritionalEstimate: entry.nutritionalEstimate,
          })
        }
      }

      await refreshSchoolMenuState()

      const sortedDates = entries.map((e) => e.date).sort()
      const result: SchoolMenuUploadResult = {
        entryCount: entries.length,
        firstDate: sortedDates[0] ?? null,
        lastDate: sortedDates[sortedDates.length - 1] ?? null,
        // Set by the caller when relevant; default false. The review flow
        // overwrites this if it tracked the parse origin.
        deterministic: false,
      }
      logger.info('[Planner] School-menu commit finished', result)
      return result
    },
    [refreshSchoolMenuState]
  )

  const uploadSchoolMenu = useCallback(
    async (pdfUri: string, childIds: string[]): Promise<SchoolMenuUploadResult> => {
      const parsed = await parseSchoolMenuForReview(pdfUri)
      const result = await commitSchoolMenuEntries(parsed.entries, childIds)
      return { ...result, deterministic: parsed.deterministic }
    },
    [parseSchoolMenuForReview, commitSchoolMenuEntries]
  )

  return (
    <PlannerContext.Provider value={{
      weekPlans,
      isLoading,
      isGenerating,
      schoolMenuChildIds,
      schoolMenuByMember,
      getMembersAtSchoolOn,
      loadWeek,
      generateWeekPlan,
      setMealForDate,
      removeMealFromDate,
      lockDay,
      uploadSchoolMenu,
      parseSchoolMenuForReview,
      commitSchoolMenuEntries,
      refreshSchoolMenuState,
      getSchoolMenuEntries,
    }}>
      {children}
    </PlannerContext.Provider>
  )
}

export function usePlanner(): PlannerContextValue {
  const ctx = useContext(PlannerContext)
  if (!ctx) throw new Error('usePlanner must be used within a PlannerProvider')
  return ctx
}
