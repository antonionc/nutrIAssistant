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
import { complete, analyzePDF } from '../../services/claude'
import { buildMealPlanGenerationPrompt, buildCloudSystemPrompt, InventoryLite } from '../../services/prompts/cloud'
import { SCHOOL_MENU_EXTRACTION_PROMPT } from '../../services/prompts/schoolMenuExtraction'
import { useProfiles } from '../profiles/ProfilesContext'
import { getRandomRecipes, searchVerifiedByCategory } from '../recipes/recipeDB'

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
  uploadSchoolMenu: (pdfBase64: string, childId: string) => Promise<void>
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

  const generateFallbackPlan = useCallback(async (startDate?: string) => {
    const dates = getWeekDates(startDate)
    const now = new Date().toISOString()
    const newPlans: MealPlan[] = []

    for (const date of dates) {
      const existing = weekPlans.find((p) => p.date === date)
      if (existing?.isLocked) {
        newPlans.push(existing)
        continue
      }

      const [breakfastRecs, lunchRecs, dinnerRecs] = await Promise.all([
        getRandomRecipes(1, 'breakfast'),
        getRandomRecipes(1, 'lunch'),
        getRandomRecipes(1, 'dinner'),
      ])

      const plan: MealPlan = {
        id: `plan-${date}`,
        date,
        meals: {
          breakfast: breakfastRecs[0],
          lunch: lunchRecs[0],
          dinner: dinnerRecs[0],
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
  }, [weekPlans])

  const generateWeekPlan = useCallback(
    async (
      inventory: InventoryLite[],
      startDate?: string
    ) => {
      setIsGenerating(true)
      try {
        const schoolAgeIds = profiles.filter((p) => p.isSchoolAge).map((p) => p.id)
        const schoolMenuEntries = (
          await Promise.all(schoolAgeIds.map((id) => getSchoolMenuEntries(id)))
        ).flat().map((e) => ({ ...e, meal: 'lunch' as const }))

        const systemPrompt = buildCloudSystemPrompt(profiles, inventory, undefined, schoolMenuEntries.length ? schoolMenuEntries : undefined)
        const userPrompt = buildMealPlanGenerationPrompt(profiles, inventory, schoolMenuEntries.length ? schoolMenuEntries : undefined, startDate)

        const response = await complete(
          [{ id: 'req', role: 'user', content: userPrompt, timestamp: new Date().toISOString() }],
          systemPrompt
        )

        const jsonStart = response.indexOf('[')
        if (jsonStart === -1) throw new Error('No JSON array in response')
        let jsonStr = response.slice(jsonStart)
        const jsonEnd = jsonStr.lastIndexOf(']')
        if (jsonEnd !== -1) jsonStr = jsonStr.slice(0, jsonEnd + 1)

        type MealEntry = {
          name: string
          calories: number
          protein: number
          carbs: number
          fat: number
        }
        let dayPlans: Array<{
          date: string
          breakfast: MealEntry
          lunch: MealEntry
          dinner: MealEntry
        }>
        try {
          dayPlans = JSON.parse(jsonStr)
        } catch {
          const partial = jsonStr.replace(/,?\s*\{[^{}]*$/, '') + ']'
          dayPlans = JSON.parse(partial.startsWith('[') ? partial : '[' + partial)
        }

        // Find the best matching verified recipe (FatSecret / seed) for a meal
        // suggestion from the AI. We never store AI-generated recipe stubs.
        const findVerifiedRecipe = async (
          mealName: string,
          category: Recipe['category']
        ): Promise<Recipe | undefined> => {
          // Try the first meaningful keyword from the AI-suggested name
          const keyword =
            mealName.split(/\s+/).find((w) => w.length > 3) ?? mealName
          const results = await searchVerifiedByCategory(keyword, category, 3)
          if (results.length > 0) return results[0]
          // Fallback: random verified recipe from the same category
          const randoms = await getRandomRecipes(1, category)
          return randoms[0]
        }

        const now = new Date().toISOString()
        const newPlans: MealPlan[] = []

        for (const dayPlan of dayPlans) {
          const existing = weekPlans.find((p) => p.date === dayPlan.date)
          if (existing?.isLocked) {
            newPlans.push(existing)
            continue
          }

          const [breakfastRecipe, lunchRecipe, dinnerRecipe] = await Promise.all([
            findVerifiedRecipe(dayPlan.breakfast.name, 'breakfast'),
            findVerifiedRecipe(dayPlan.lunch.name, 'lunch'),
            findVerifiedRecipe(dayPlan.dinner.name, 'dinner'),
          ])

          const plan: MealPlan = {
            id: `plan-${dayPlan.date}`,
            date: dayPlan.date,
            meals: {
              breakfast: breakfastRecipe,
              lunch: lunchRecipe,
              dinner: dinnerRecipe,
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
        await generateFallbackPlan(startDate)
      } finally {
        setIsGenerating(false)
      }
    },
    [profiles, weekPlans, generateFallbackPlan]
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

  const uploadSchoolMenu = useCallback(
    async (pdfBase64: string, childId: string): Promise<void> => {
      const response = await analyzePDF(pdfBase64, SCHOOL_MENU_EXTRACTION_PROMPT)
      const jsonMatch = response.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error('Could not extract school menu data')

      const entries: Array<{
        date: string; description: string; extractedIngredients: string[];
        extractedAllergens: string[]; nutritionalEstimate?: { calories: number; protein: number; carbs: number; fat: number }
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
