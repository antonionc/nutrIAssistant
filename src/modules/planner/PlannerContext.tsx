import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { MealPlan } from '../../types/planner'
import { Recipe } from '../../types/recipes'
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

type SchoolMenuParsedEntry = {
  date: string
  description: string
  extractedIngredients: string[]
  extractedAllergens: string[]
  nutritionalEstimate?: { calories: number; protein: number; carbs: number; fat: number }
}

// Permissive extractor for the on-device LLM's school-menu response. Handles:
//   - bare JSON arrays ([...])
//   - arrays wrapped in markdown code fences (```json ... ```)
//   - arrays nested inside an object ({"days":[...]} / {"menu":[...]})
//   - truncated tails: if the closing "]" is missing, we re-balance brackets
//     and drop the last (incomplete) element so the rest is still salvageable.
// Returns null when nothing usable can be parsed.
function parseSchoolMenuResponse(raw: string): SchoolMenuParsedEntry[] | null {
  // 1a. Strip well-formed <think>…</think> blocks.
  // 1b. Strip a dangling <think>… with no closing tag (Qwen 3 sometimes runs
  //     out of tokens mid-reasoning and never closes the block). Without /no_think
  //     this consumes the whole response — we still try to recover anything past
  //     a stray </think> if one exists.
  let s = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .replace(/^[\s\S]*?<\/think>/, '')
    .trim()

  // Qwen 3 1.7B occasionally forgets the `},{` array-element separator and
  // emits `}","date":...` (stray quote + comma instead of `},{`). The lookahead
  // anchors on what looks like a JSON object opening a new entry, so we don't
  // touch this sequence when it appears inside a string value.
  s = s.replace(/\}",\s*(?="[\w-]+"\s*:)/g, '},{')

  // 2. Strip markdown code fences if present.
  s = s.replace(/```(?:json|JSON)?\s*([\s\S]*?)```/g, '$1').trim()

  // 3. Greedy match for the outermost [...] block.
  const arrayMatch = s.match(/\[[\s\S]*\]/)
  const candidates: string[] = []
  if (arrayMatch) candidates.push(arrayMatch[0])

  // 4. If we never found a closing "]", try to salvage a truncated array by
  //    cutting after the last complete object and appending "]".
  const firstBracket = s.indexOf('[')
  if (firstBracket !== -1 && s.indexOf(']', firstBracket) === -1) {
    const tail = s.slice(firstBracket)
    const lastObjectEnd = tail.lastIndexOf('}')
    if (lastObjectEnd !== -1) {
      candidates.push(tail.slice(0, lastObjectEnd + 1) + ']')
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (Array.isArray(parsed)) return parsed as SchoolMenuParsedEntry[]
    } catch {
      // try next candidate
    }
  }

  // 5. Last resort: the LLM wrapped the array in an object. Find the first
  //    "{...}" block and look for an array-valued property inside it.
  const objectMatch = s.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try {
      const parsedObj = JSON.parse(objectMatch[0])
      if (parsedObj && typeof parsedObj === 'object') {
        for (const value of Object.values(parsedObj)) {
          if (Array.isArray(value)) return value as SchoolMenuParsedEntry[]
        }
      }
    } catch {
      // give up
    }
  }

  return null
}

export type SchoolMenuUploadStage =
  | 'llm_not_ready'
  | 'pdf_empty'
  | 'pdf_extract'
  | 'llm_parse'
  | 'llm_generate'

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
  uploadSchoolMenu: (pdfUri: string, childIds: string[]) => Promise<void>
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

      // Small on-device models occasionally wrap the array in markdown fences,
      // emit a preamble, or wrap it in an object ({"days":[...]}). Be permissive
      // when extracting the JSON payload before parsing.
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

      let response = await runLLM(SCHOOL_MENU_EXTRACTION_PROMPT)
      let entries = parseSchoolMenuResponse(response)

      // Retry with a much simpler schema if the first attempt was unparseable.
      // Small models (~1.7B) produce date+description arrays far more reliably
      // than full nutrition/allergen objects. Fill defaults for the dropped fields.
      if (!entries) {
        // Do NOT log the response body — it can contain child names, school
        // identifiers and other PII extracted from the menu PDF. Only the
        // length is needed to diagnose truncation vs. unparseable shape.
        logger.warn(
          '[Planner] First-pass school-menu parse failed; retrying with simpler schema',
          { responseLength: response.length }
        )
        response = await runLLM(SCHOOL_MENU_EXTRACTION_PROMPT_SIMPLE)
        const simple = parseSchoolMenuResponse(response)
        if (simple) {
          entries = simple.map((e) => ({
            date: e.date,
            description: e.description,
            extractedIngredients: e.extractedIngredients ?? [],
            extractedAllergens: e.extractedAllergens ?? [],
            nutritionalEstimate: e.nutritionalEstimate,
          }))
        }
      }

      if (!entries) {
        logger.error(
          '[Planner] School-menu retry still unparseable; aborting upload',
          { responseLength: response.length }
        )
        throw new SchoolMenuUploadError('llm_parse')
      }

      for (const childId of childIds) {
        await deleteSchoolMenuEntriesForChild(childId)
        for (const entry of entries) {
          await saveSchoolMenuEntry({
            id: `school-${entry.date}-${childId}`,
            date: entry.date,
            childId,
            description: entry.description,
            extractedIngredients: entry.extractedIngredients,
            extractedAllergens: entry.extractedAllergens,
            nutritionalEstimate: entry.nutritionalEstimate,
          })
        }
      }

      await refreshSchoolMenuState()
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
