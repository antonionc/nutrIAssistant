import { logger } from '../utils/logger'
export function safeJsonParse<T>(json: string | unknown, fallback: T): T {
  if (typeof json !== 'string' || !json) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    // Do NOT log the JSON body — it can be a member-profile blob with
    // unencrypted name/role/age. Length is enough to diagnose truncation.
    logger.warn('[DB] Failed to parse JSON column, using fallback', { length: json.length })
    return fallback
  }
}
