import { z } from 'zod'
import { NutritionalInfo, NutriScore } from '../types/nutrition'
import { bffGet } from './bff/client'
import { logger } from '../utils/logger'

// Zod schema for runtime validation of OFF responses. Catches upstream
// schema drift (renamed/removed fields) so we degrade to "product not
// found" rather than rendering UI with `undefined` everywhere.
const offResponseSchema = z.object({
  status: z.number(),
  product: z
    .object({
      product_name: z.string().optional(),
      brands: z.string().optional(),
      nutriscore_grade: z.string().optional(),
      allergens_tags: z.array(z.string()).optional(),
      ingredients_text: z.string().optional(),
      nutriments: z.record(z.string(), z.number()).optional(),
      image_url: z.string().optional(),
    })
    .optional(),
})

// All calls go through the BFF (https://api.nutriassistant.org). The BFF
// proxies OpenFoodFacts via the `.net` alias to avoid the CF↔CF HTTP 525
// pathology and adds edge caching (24h TTL on barcode lookups).

interface OFFNutriments {
  'energy-kcal_100g'?: number
  proteins_100g?: number
  carbohydrates_100g?: number
  fat_100g?: number
  fiber_100g?: number
  sugars_100g?: number
  sodium_100g?: number
  calcium_100g?: number
  iron_100g?: number
  'saturated-fat_100g'?: number
  'vitamin-c_100g'?: number
}

interface OFFProduct {
  product_name?: string
  brands?: string
  nutriscore_grade?: string
  allergens_tags?: string[]
  ingredients_text?: string
  nutriments?: OFFNutriments
  image_url?: string
}

interface OFFResponse {
  status: number
  product?: OFFProduct
}

function mapNutriments(n: OFFNutriments): NutritionalInfo {
  return {
    calories: n['energy-kcal_100g'] ?? 0,
    protein: n.proteins_100g ?? 0,
    carbs: n.carbohydrates_100g ?? 0,
    fat: n.fat_100g ?? 0,
    fiber: n.fiber_100g,
    sugar: n.sugars_100g,
    sodium: n.sodium_100g ? n.sodium_100g * 1000 : undefined, // g → mg
    calcium: n.calcium_100g ? n.calcium_100g * 1000 : undefined,
    iron: n.iron_100g ? n.iron_100g * 1000 : undefined,
    saturatedFat: n['saturated-fat_100g'],
    vitaminC: n['vitamin-c_100g'] ? n['vitamin-c_100g'] * 1000 : undefined,
  }
}

function parseNutriScore(grade?: string): NutriScore | undefined {
  if (!grade) return undefined
  const upper = grade.toUpperCase()
  if (['A', 'B', 'C', 'D', 'E'].includes(upper)) return upper as NutriScore
  return undefined
}

export interface OFFScanResult {
  productName: string
  brand: string
  nutritionalInfo: NutritionalInfo
  nutriscore?: NutriScore
  allergens: string[]
  ingredientsText: string
  imageUrl?: string
}

export async function getProductByBarcode(barcode: string): Promise<OFFScanResult | null> {
  let raw: unknown
  try {
    raw = await bffGet<unknown>({
      service: 'OpenFoodFacts',
      path: `/v1/off/product/${barcode}`,
    })
  } catch {
    // Network / 502 / etc. — surface as "no product found" so the scanner
    // UI can offer to add the product manually.
    return null
  }
  const parsed = offResponseSchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn('[OpenFoodFacts] upstream schema drift', {
      issues: parsed.error.issues.slice(0, 3).map((i) => ({ path: i.path, code: i.code })),
    })
    return null
  }
  const data = parsed.data as OFFResponse
  if (data.status !== 1 || !data.product) return null

  const p = data.product
  const allergens = (p.allergens_tags ?? []).map((a) =>
    a.replace('en:', '').replace('-', ' ')
  )

  return {
    productName: p.product_name ?? 'Unknown product',
    brand: p.brands ?? '',
    nutritionalInfo: p.nutriments ? mapNutriments(p.nutriments) : { calories: 0, protein: 0, carbs: 0, fat: 0 },
    nutriscore: parseNutriScore(p.nutriscore_grade),
    allergens,
    ingredientsText: p.ingredients_text ?? '',
    imageUrl: p.image_url,
  }
}
