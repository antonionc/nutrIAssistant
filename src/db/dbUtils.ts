export function safeJsonParse<T>(json: string | unknown, fallback: T): T {
  if (typeof json !== 'string' || !json) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    console.warn('[DB] Failed to parse JSON column, using fallback:', json.slice(0, 80))
    return fallback
  }
}
