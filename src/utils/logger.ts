/**
 * Central logger with PII scrubbing. Replaces direct console.* calls so:
 *   1. We can route to Sentry/PostHog later without touching call sites.
 *   2. Every structured payload passes through `scrub()` — encrypted blobs
 *      (`enc:v1:` prefix), long strings, and PII-shaped field names are
 *      dropped before reaching any sink.
 *
 * The current implementation still uses `console.*` under the hood. When a
 * remote APM is wired in, the only change is the body of `emit()` — call
 * sites stay identical.
 *
 * Usage:
 *   logger.info('[Category] message')
 *   logger.warn('[Category] message', { context: ... })
 *   logger.error('[Category] failed', { err })
 *
 * The `[Category]` prefix is project convention (already in use across
 * 22 files); keep it for grep-ability.
 */

const MAX_STRING_LEN = 200

// Field names whose VALUES we never want in any log sink, even if the
// caller forgets to redact them. Lowercased substring match.
const PII_KEY_PATTERNS = [
  'name', 'email', 'dob', 'birth', 'weight', 'height',
  'allerg', 'condition', 'memory', 'memories',
  'message', 'prompt', 'response', 'text', 'content',
  'password', 'token', 'secret', 'apikey', 'api_key',
  'address', 'phone',
] as const

function isPiiKey(key: string): boolean {
  const k = key.toLowerCase()
  return PII_KEY_PATTERNS.some((p) => k.includes(p))
}

function scrubValue(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    // Already encrypted blobs are safe by definition but noisy and useless
    // in a log — drop them.
    if (value.startsWith('enc:v1:') || value.startsWith('enc:v2:')) {
      return '[encrypted]'
    }
    if (value.length > MAX_STRING_LEN) {
      return `[truncated len=${value.length}]`
    }
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(scrubValue)
  if (value instanceof Error) {
    return { name: value.name, message: scrubValue(value.message) }
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isPiiKey(k)) {
        out[k] = '[redacted]'
      } else {
        out[k] = scrubValue(v)
      }
    }
    return out
  }
  return '[unloggable]'
}

export function scrub(meta: unknown): unknown {
  return scrubValue(meta)
}

type Level = 'debug' | 'info' | 'warn' | 'error'

function emit(level: Level, message: string, meta?: unknown): void {
  const scrubbed = meta === undefined ? undefined : scrubValue(meta)
  // Switch on level so dev-tools group errors/warnings correctly.
  switch (level) {
    case 'debug':
      // eslint-disable-next-line no-console
      if (scrubbed === undefined) console.log(message)
      // eslint-disable-next-line no-console
      else console.log(message, scrubbed)
      return
    case 'info':
      // eslint-disable-next-line no-console
      if (scrubbed === undefined) console.info(message)
      // eslint-disable-next-line no-console
      else console.info(message, scrubbed)
      return
    case 'warn':
      // eslint-disable-next-line no-console
      if (scrubbed === undefined) console.warn(message)
      // eslint-disable-next-line no-console
      else console.warn(message, scrubbed)
      return
    case 'error':
      // eslint-disable-next-line no-console
      if (scrubbed === undefined) console.error(message)
      // eslint-disable-next-line no-console
      else console.error(message, scrubbed)
      return
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => emit('debug', message, meta),
  info: (message: string, meta?: unknown) => emit('info', message, meta),
  warn: (message: string, meta?: unknown) => emit('warn', message, meta),
  error: (message: string, meta?: unknown) => emit('error', message, meta),
}
