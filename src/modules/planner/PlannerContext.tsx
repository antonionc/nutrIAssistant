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
import { extractPdfText } from '../../../modules/expo-pdf-text'
import { generateOnDevice, getLLMStatus } from '../../services/onDeviceLlm'
import { InventoryLite } from '../../services/prompts/system'
import {
  SCHOOL_MENU_EXTRACTION_PROMPT,
  SCHOOL_MENU_EXTRACTION_PROMPT_SIMPLE,
} from '../../services/prompts/schoolMenuExtraction'
import {
  parseSchoolMenuResponse,
  normalizeSchoolMenuEntry,
  deterministicSchoolMenuParse,
} from '../../services/schoolMenuParser'
import { useProfiles } from '../profiles/ProfilesContext'
import { selectWeekRecipes } from './mealPlanGenerator'
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
  loadWeek: (startDate?: string) => Promise<void>
  generateWeekPlan: (
    inventory: InventoryLite[],
    startDate?: string
  ) => Promise<void>
  setMealForDate: (date: string, mealType: MealSlot, recipe: Recipe) => Promise<void>
  removeMealFromDate: (date: string, mealType: MealSlot) => Promise<void>
  lockDay: (date: string) => Promise<void>
  uploadSchoolMenu: (pdfUri: string, childIds: string[]) => Promise<SchoolMenuUploadResult>
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
  }, [])

  useEffect(() => {
    loadWeek()
    refreshSchoolMenuState()
  }, [loadWeek, refreshSchoolMenuState])

  /**
   * Generates a 7-day meal plan from locally-stored recipes. Uses the
   * on-device LLM when available to curate cuisine/variety; otherwise falls
   * back to a deterministic algorithmic picker that guarantees no
   * within-week repeats and rotates cuisines. School-menu lunch entries are
   * respected for school-age kids. No cloud AI calls.
   */
  const generateWeekPlan = useCallback(
    async (_inventory: InventoryLite[], startDate?: string) => {
      setIsGenerating(true)
      try {
        const dates = getWeekDates(startDate)

        // Collect school menu dates so we can skip lunches for those days
        const schoolAgeIds = profiles.filter((p) => p.isSchoolAge).map((p) => p.id)
        const schoolMenuEntries = (
          await Promise.all(schoolAgeIds.map((id) => getSchoolMenuEntries(id)))
        ).flat()
        const schoolMenuDates = new Set(schoolMenuEntries.map((e) => e.date))

        const { breakfasts, lunches, dinners } = await selectWeekRecipes(profiles)

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
              // If there is a school menu for this day, leave lunch undefined
              // so it doesn't compete with what the child eats at school
              lunch: schoolMenuDates.has(date) ? undefined : lunches[i],
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

  // School menu upload runs entirely on-device: PDF text is extracted via the
  // expo-pdf-text native module (PDFKit on iOS, PdfBox on Android), then the
  // local LLM parses it into structured entries. The PDF is parsed and the LLM
  // is invoked ONCE per upload; results are written per target child after
  // wiping that child's previous entries (true replace semantics).
  const uploadSchoolMenu = useCallback(
    async (pdfUri: string, childIds: string[]): Promise<void> => {
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

      // 1. Deterministic pass — most Spanish/English school menus follow a
      //    "LUNES 6 DE ABRIL / Primer plato: … / Segundo plato: … / Postre: …"
      //    shape that regex can extract reliably. Skips the LLM entirely
      //    when ≥3 days come back with at least one identified course.
      const deterministic = deterministicSchoolMenuParse(pdfText)
      let entries: Array<Omit<SchoolMenuEntry, 'id' | 'childId'>> = []
      if (deterministic.length >= 3) {
        entries = deterministic
        logger.info('[Planner] School-menu parsed deterministically', { entryCount: entries.length })
      } else {
        // 2. LLM pass. Try the SIMPLE schema first (date + 3 courses) —
        //    smaller schemas are far more reliable on a 1.7B model. Fall
        //    back to the full schema only if the simple one fails.
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

        let response = await runLLM(SCHOOL_MENU_EXTRACTION_PROMPT_SIMPLE)
        let parsed = parseSchoolMenuResponse(response)

        if (!parsed) {
          logger.warn(
            '[Planner] Simple-schema school-menu parse failed; retrying with full schema',
            {
              responseLength: response.length,
              // In dev, surface the first 300 chars of the response so we
              // can iterate. PII risk is local-only; redacted in release.
              ...(__DEV__ ? { responseHead: response.slice(0, 300) } : {}),
            }
          )
          response = await runLLM(SCHOOL_MENU_EXTRACTION_PROMPT)
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

        entries = parsed
          .map(normalizeSchoolMenuEntry)
          .filter((e): e is NonNullable<typeof e> => e !== null)

        if (entries.length === 0) {
          // Last resort: if the LLM produced something but normalisation
          // rejected every entry (e.g. bad dates), see if the deterministic
          // pass salvaged anything we previously rejected for being <3 days.
          if (deterministic.length > 0) {
            entries = deterministic
            logger.info('[Planner] Falling back to deterministic parse after LLM normalisation produced 0 entries')
          } else {
            logger.warn('[Planner] School-menu parse produced 0 valid entries after normalisation')
            throw new SchoolMenuUploadError('llm_parse')
          }
        }
      }

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
        deterministic: entries === deterministic,
      }
      logger.info('[Planner] School-menu upload finished', result)
      return result
    },
    [refreshSchoolMenuState]
  )

  return (
    <PlannerContext.Provider value={{
      weekPlans,
      isLoading,
      isGenerating,
      schoolMenuChildIds,
      loadWeek,
      generateWeekPlan,
      setMealForDate,
      removeMealFromDate,
      lockDay,
      uploadSchoolMenu,
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
