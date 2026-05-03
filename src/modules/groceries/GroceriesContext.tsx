import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Linking } from 'react-native'
import { generateId } from '../../utils/idUtils'
import { translateIngredient, translateUnit } from '../../utils/ingredientTranslations'
import { GroceryItem, GroceryCategory, GROCERY_CATEGORY_LABELS, GroceryGroup } from '../../types/groceries'
import { MealPlan } from '../../types/planner'
import { InventoryItem } from '../../types/inventory'
import {
  getAllGroceryItems,
  upsertGroceryItem,
  togglePurchasedDB,
  deleteGroceryItem,
  clearPurchasedItems,
  batchInsertGroceryItems,
  findActiveItemByName,
  updateGroceryItemQuantity,
} from './groceriesDB'
import { inferGroceryCategory } from './groceryUtils'

interface GroceriesContextValue {
  items: GroceryItem[]
  activeItems: GroceryItem[]
  purchasedItems: GroceryItem[]
  isLoading: boolean
  reload: () => Promise<void>
  addItem: (name: string, quantity?: number, unit?: string, notes?: string) => Promise<void>
  togglePurchased: (id: string) => Promise<void>
  removeItem: (id: string) => Promise<void>
  clearPurchased: () => Promise<void>
  autoPopulateFromPlan: (plans: MealPlan[], inventory: InventoryItem[]) => Promise<void>
  exportToAmazon: () => void
  grouped: () => GroceryGroup[]
}

const GroceriesContext = createContext<GroceriesContextValue | null>(null)

export function GroceriesProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<GroceryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    setIsLoading(true)
    const all = await getAllGroceryItems()
    setItems(all)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const addItem = useCallback(
    async (name: string, quantity = 1, unit = 'units', notes?: string) => {
      const category = inferGroceryCategory(name)
      const translatedName = translateIngredient(name)
      const translatedUnit = translateUnit(unit)

      // Merge into an existing unpurchased item with the same name
      const existing = await findActiveItemByName(translatedName)
      if (existing) {
        const merged = existing.quantity + quantity
        await updateGroceryItemQuantity(existing.id, merged)
        setItems((prev) =>
          prev.map((item) => (item.id === existing.id ? { ...item, quantity: merged } : item))
        )
        return
      }

      const newItem: GroceryItem = {
        id: generateId('groc'),
        name: translatedName,
        quantity,
        unit: translatedUnit,
        category,
        notes,
        isPurchased: false,
        addedAt: new Date().toISOString(),
        fromMealPlan: false,
      }
      await upsertGroceryItem(newItem)
      setItems((prev) => [...prev, newItem])
    },
    []
  )

  const togglePurchased = useCallback(async (id: string) => {
    await togglePurchasedDB(id)
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, isPurchased: !item.isPurchased, purchasedAt: !item.isPurchased ? new Date().toISOString() : undefined }
          : item
      )
    )
  }, [])

  const removeItem = useCallback(async (id: string) => {
    await deleteGroceryItem(id)
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const clearPurchased = useCallback(async () => {
    await clearPurchasedItems()
    setItems((prev) => prev.filter((item) => !item.isPurchased))
  }, [])

  const autoPopulateFromPlan = useCallback(
    async (plans: MealPlan[], inventory: InventoryItem[]) => {
      const inventoryNames = inventory.map((i) => i.name.toLowerCase())

      // Aggregate quantities for duplicate ingredients across all meals/plans
      const ingredientMap = new Map<string, GroceryItem>()

      for (const plan of plans) {
        for (const meal of [plan.meals.breakfast, plan.meals.lunch, plan.meals.dinner]) {
          if (!meal) continue
          for (const ing of meal.ingredients) {
            const inStock = inventoryNames.some(
              (name) =>
                name.includes(ing.name.toLowerCase()) ||
                ing.name.toLowerCase().includes(name)
            )
            if (inStock) continue

            const translatedName = translateIngredient(ing.name)
            const key = translatedName.toLowerCase()

            if (ingredientMap.has(key)) {
              const prev = ingredientMap.get(key)!
              ingredientMap.set(key, { ...prev, quantity: prev.quantity + ing.quantity })
            } else {
              ingredientMap.set(key, {
                id: generateId('groc-plan'),
                name: translatedName,
                quantity: ing.quantity,
                unit: translateUnit(ing.unit),
                category: inferGroceryCategory(ing.name),
                isPurchased: false,
                addedAt: new Date().toISOString(),
                fromMealPlan: true,
                recipeId: meal.id,
              })
            }
          }
        }
      }

      const newItems = Array.from(ingredientMap.values())

      await batchInsertGroceryItems(newItems)
      setItems((prev) => {
        const existingNames = new Set(prev.map((i) => i.name.toLowerCase()))
        const fresh = newItems.filter((i) => !existingNames.has(i.name.toLowerCase()))
        return [...prev, ...fresh]
      })
    },
    []
  )

  const exportToAmazon = useCallback(() => {
    const activeItems = items.filter((i) => !i.isPurchased)
    if (activeItems.length === 0) return
    const query = activeItems.map((i) => i.name).join(', ')
    Linking.openURL(`https://www.amazon.es/s?k=${encodeURIComponent(query)}`)
  }, [items])

  const grouped = useCallback((): GroceryGroup[] => {
    const categories: GroceryCategory[] = [
      'fruits_vegetables', 'proteins', 'dairy_alternatives', 'grains_pantry', 'other',
    ]
    return categories
      .map((cat) => ({
        category: cat,
        label: GROCERY_CATEGORY_LABELS[cat],
        items: items.filter((i) => !i.isPurchased && i.category === cat),
      }))
      .filter((g) => g.items.length > 0)
  }, [items])

  const activeItems = items.filter((i) => !i.isPurchased)
  const purchasedItems = items.filter((i) => i.isPurchased)

  return (
    <GroceriesContext.Provider
      value={{
        items,
        activeItems,
        purchasedItems,
        isLoading,
        reload,
        addItem,
        togglePurchased,
        removeItem,
        clearPurchased,
        autoPopulateFromPlan,
        exportToAmazon,
        grouped,
      }}
    >
      {children}
    </GroceriesContext.Provider>
  )
}

export function useGroceries(): GroceriesContextValue {
  const ctx = useContext(GroceriesContext)
  if (!ctx) throw new Error('useGroceries must be used within GroceriesProvider')
  return ctx
}
