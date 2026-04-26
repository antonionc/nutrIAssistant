export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}`
}
