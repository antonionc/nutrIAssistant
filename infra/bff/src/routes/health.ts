import { Hono } from 'hono'
import type { AppContext } from '../env'

export const healthRoute = new Hono<AppContext>()

healthRoute.get('/', (c) => {
  return c.json({
    status: 'ok',
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  })
})
