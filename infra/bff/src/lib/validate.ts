import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'

/**
 * Parse + validate, raising a 400 with a useful message if invalid.
 * Centralized so route files stay terse.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    const firstIssue = result.error.issues[0]
    const path = firstIssue?.path.join('.') || 'input'
    throw new HTTPException(400, {
      message: `invalid_input:${path}:${firstIssue?.message ?? 'unknown'}`,
      cause: 'invalid_input',
    })
  }
  return result.data
}

// ── Common parameter schemas (reused across routes) ────────────────────────

export const barcodeSchema = z
  .string()
  .regex(/^\d{8,14}$/, 'barcode must be 8-14 digits')

export const positiveIntStringSchema = z
  .string()
  .regex(/^\d+$/, 'must be a positive integer')

export const recipeIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,32}$/, 'recipe id must be alphanumeric')
