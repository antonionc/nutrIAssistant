import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { InventoryItem } from '../../types/inventory'
import { Recipe } from '../../types/recipes'
import { generateId } from '../../utils/idUtils'
import {
  getAllInventoryItems,
  upsertInventoryItem,
  deleteInventoryItem,
  updateQuantity,
  getItemsByExpiryAlert,
  getExpiredItems,
} from './inventoryDB'

interface InventoryContextValue {
  items: InventoryItem[]
  expiryAlerts: InventoryItem[]
  expiredItems: InventoryItem[]
  isLoading: boolean
  reload: () => Promise<void>
  addItem: (item: Omit<InventoryItem, 'id' | 'addedAt'>) => Promise<void>
  updateItem: (id: string, updates: Partial<InventoryItem>) => Promise<void>
  removeItem: (id: string) => Promise<void>
  decrementIngredients: (recipe: Recipe) => Promise<void>
  getLowStockAlerts: () => InventoryItem[]
}

const InventoryContext = createContext<InventoryContextValue | null>(null)

export function InventoryProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [expiryAlerts, setExpiryAlerts] = useState<InventoryItem[]>([])
  const [expiredItems, setExpiredItems] = useState<InventoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    setIsLoading(true)
    const [all, expiring, expired] = await Promise.all([
      getAllInventoryItems(),
      getItemsByExpiryAlert(3),
      getExpiredItems(),
    ])
    setItems(all)
    setExpiryAlerts(expiring)
    setExpiredItems(expired)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const addItem = useCallback(
    async (item: Omit<InventoryItem, 'id' | 'addedAt'>) => {
      const newItem: InventoryItem = {
        ...item,
        id: generateId('inv'),
        addedAt: new Date().toISOString(),
      }
      await upsertInventoryItem(newItem)
      await reload()
    },
    [reload]
  )

  const updateItem = useCallback(
    async (id: string, updates: Partial<InventoryItem>) => {
      const existing = items.find((i) => i.id === id)
      if (!existing) return
      const updated = { ...existing, ...updates }
      await upsertInventoryItem(updated)
      await reload()
    },
    [items, reload]
  )

  const removeItem = useCallback(
    async (id: string) => {
      await deleteInventoryItem(id)
      await reload()
    },
    [reload]
  )

  const decrementIngredients = useCallback(
    async (recipe: Recipe) => {
      for (const ingredient of recipe.ingredients) {
        const match = items.find(
          (item) =>
            item.name.toLowerCase().includes(ingredient.name.toLowerCase()) ||
            ingredient.name.toLowerCase().includes(item.name.toLowerCase())
        )
        if (match) {
          const newQty = Math.max(0, match.quantity - ingredient.quantity)
          await updateQuantity(match.id, newQty)
        }
      }
      await reload()
    },
    [items, reload]
  )

  const getLowStockAlerts = useCallback((): InventoryItem[] => {
    return items.filter(
      (item) =>
        item.lowStockThreshold !== undefined &&
        item.quantity <= item.lowStockThreshold
    )
  }, [items])

  return (
    <InventoryContext.Provider
      value={{
        items,
        expiryAlerts,
        expiredItems,
        isLoading,
        reload,
        addItem,
        updateItem,
        removeItem,
        decrementIngredients,
        getLowStockAlerts,
      }}
    >
      {children}
    </InventoryContext.Provider>
  )
}

export function useInventory(): InventoryContextValue {
  const ctx = useContext(InventoryContext)
  if (!ctx) throw new Error('useInventory must be used within an InventoryProvider')
  return ctx
}
