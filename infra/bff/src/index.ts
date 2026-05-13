import { Hono } from 'hono'
import type { AppContext } from './env'
import { errorHandler } from './middleware/errors'
import { rateLimit } from './middleware/rateLimit'
import { healthRoute } from './routes/health'
import { offRoute } from './routes/off'
import { spoonacularRoute } from './routes/spoonacular'
import { edamamRoute } from './routes/edamam'
import { llmRoute } from './routes/llm'

const app = new Hono<AppContext>()

// Order matters: errors first so it wraps everything; rate-limit after so
// 429s also pass through the unified error formatter.
app.use('*', errorHandler)
app.use('/v1/*', rateLimit)

app.route('/v1/health', healthRoute)
app.route('/v1/off', offRoute)
app.route('/v1/spoonacular', spoonacularRoute)
app.route('/v1/edamam', edamamRoute)
app.route('/v1/llm', llmRoute)

app.notFound((c) =>
  c.json({ error: 'not_found', code: 'not_found', requestId: c.req.header('cf-ray') ?? '' }, 404),
)

export default app
