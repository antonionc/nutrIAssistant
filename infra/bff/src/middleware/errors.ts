import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppContext } from '../env'

interface ErrorBody {
  error: string
  code: string
  requestId: string
}

/**
 * Unified error response. Upstream details (status text, stack traces) are
 * never leaked — only a stable error code and the Cloudflare ray id for
 * support correlation.
 */
export const errorHandler: MiddlewareHandler<AppContext> = async (c, next) => {
  try {
    await next()
  } catch (err) {
    const requestId = c.req.header('cf-ray') ?? crypto.randomUUID()

    if (err instanceof HTTPException) {
      const body: ErrorBody = {
        error: err.message,
        code: err.cause as string ?? 'http_error',
        requestId,
      }
      return c.json(body, err.status)
    }

    // Unknown error — log to Worker tail, surface a generic 500.
    console.error(JSON.stringify({
      level: 'error',
      msg: 'unhandled_error',
      requestId,
      path: c.req.path,
      error: err instanceof Error ? err.message : String(err),
    }))

    const body: ErrorBody = {
      error: 'internal_error',
      code: 'internal_error',
      requestId,
    }
    return c.json(body, 500)
  }
}
