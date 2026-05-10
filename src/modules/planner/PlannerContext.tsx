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
} from './plannerDB'
import { extractPdfText } from '../../../modules/expo-pdf-text'
import { generateOnDevice } from '../../services/onDeviceLlm'
import { InventoryLite } from '../../services/prompts/system'
import { SCHOOL_MENU_EXTRACTION_PROMPT } from '../../services/prompts/schoolMenuExtraction'
import { useProfiles } from '../profiles/ProfilesContext'
import { selectWeekRecipes } from './mealPlanGenerator'

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

interface PlannerContextValue {
  weekPlans: MealPlan[]
  isLoading: boolean
  isGenerating: boolean
  loadWeek: (startDate?: string) => Promise<void>
  generateWeekPlan: (
    inventory: InventoryLite[],
    startDate?: string
  ) => Promise<void>
  setMealForDate: (date: string, mealType: MealSlot, recipe: Recipe) => Promise<void>
  removeMealFromDate: (date: string, mealType: MealSlot) => Promise<void>
  lockDay: (date: string) => Promise<void>
  uploadSchoolMenu: (pdfUri: string, childId: string) => Promise<void>
  getSchoolMenuEntries: typeof getSchoolMenuEntries
}

const PlannerContext = createContext<PlannerContextValue | null>(null)

export function PlannerProvider({ children }: { children: React.ReactNode }) {
  const { profiles } = useProfiles()
  const [weekPlans, setWeekPlans] = useState<MealPlan[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)

  const loadWeek = useCallback(async (startDate?: string) => {
    setIsLoading(true)
    const dates = getWeekDates(startDate)
    const plans = await getMealPlansForRange(dates[0], dates[6])
    setWeekPlans(plans)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    loadWeek()
  }, [loadWeek])

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
        console.error('[Planner] Generation failed:', error)
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
  // local LLM parses it into structured entries.
  const uploadSchoolMenu = useCallback(
    async (pdfUri: string, childId: string): Promise<void> => {
      const pdfText = await extractPdfText(pdfUri)
      if (!pdfText.trim()) throw new Error('Could not extract text from PDF')

      const userPrompt = `${SCHOOL_MENU_EXTRACTION_PROMPT}\n\nPDF TEXT:\n${pdfText}`
      const response = await generateOnDevice(
        userPrompt,
        'You extract structured school-menu data and return ONLY a JSON array. No markdown, no commentary.'
      )

      const jsonMatch = response.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error('Could not extract school menu data')

      const entries: Array<{
        date: string
        description: string
        extractedIngredients: string[]
        extractedAllergens: string[]
        nutritionalEstimate?: { calories: number; protein: number; carbs: number; fat: number }
      }> = JSON.parse(jsonMatch[0])

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
    },
    []
  )

  return (
    <PlannerContext.Provider value={{
      weekPlans,
      isLoading,
      isGenerating,
      loadWeek,
      generateWeekPlan,
      setMealForDate,
      removeMealFromDate,
      lockDay,
      uploadSchoolMenu,
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
