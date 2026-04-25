import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Linking } from 'react-native'
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
      const newItem: GroceryItem = {
        id: `groc-${Date.now()}`,
        name,
        quantity,
        unit,
        category: inferGroceryCategory(name),
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
      const newItems: GroceryItem[] = []

      for (const plan of plans) {
        for (const meal of [plan.meals.breakfast, plan.meals.lunch, plan.meals.dinner]) {
          if (!meal) continue
          for (const ing of meal.ingredients) {
            const inStock = inventoryNames.some(
              (name) =>
                name.includes(ing.name.toLowerCase()) ||
                ing.name.toLowerCase().includes(name)
            )
            if (!inStock) {
              newItems.push({
                id: `groc-plan-${Date.now()}-${Math.random()}`,
                name: ing.name,
                quantity: ing.quantity,
                unit: ing.unit,
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

      const uniqueItems = newItems.filter(
        (item, idx, arr) =>
          arr.findIndex((i) => i.name.toLowerCase() === item.name.toLowerCase()) === idx
      )

      await batchInsertGroceryItems(uniqueItems)
      setItems((prev) => {
        const existingNames = new Set(prev.map((i) => i.name.toLowerCase()))
        const fresh = uniqueItems.filter((i) => !existingNames.has(i.name.toLowerCase()))
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
