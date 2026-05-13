import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppContext } from '../env'

export const llmRoute = new Hono<AppContext>()

/**
 * GET /v1/llm/:model/:file
 *
 * Serves on-device LLM artifacts (the `.pte` weights + tokenizer JSONs) from
 * an R2 bucket. The mobile app fetches these once during first-run init.
 *
 * Why proxy instead of pulling directly from HuggingFace:
 *   1. Latency. HuggingFace's CDN has variable behavior in EU/LATAM and
 *      occasionally returns 503. Cloudflare's global edge keeps p50 down.
 *   2. SLA. R2 + Workers are infra we control; HF outages don't break
 *      first-launch onboarding.
 *   3. Cost. R2 egress to Workers is free; egress to clients is billed,
 *      but small JSONs are edge-cached after the first hit.
 *
 * Path layout in the bucket: `<model>/<file>` (e.g. `qwen3-1.7b/model.pte`).
 * The Worker validates both segments against an allowlist so the bucket
 * cannot be enumerated.
 *
 * Files larger than Cloudflare's per-resource cache cap (currently 512 MB,
 * the .pte exceeds this) still pass through R2 on every cold colo, but
 * R2↔Worker egress is free and same-region, so this is far cheaper and
 * faster than re-pulling from HuggingFace.
 */

// Whitelisted model namespaces. Adding a new model = add an entry here and
// upload its files under that prefix in R2.
const ALLOWED_MODELS: Record<string, ReadonlySet<string>> = {
  'qwen3-1.7b': new Set(['model.pte', 'tokenizer.json', 'tokenizer_config.json']),
}

function contentTypeFor(file: string): string {
  if (file.endsWith('.json')) return 'application/json; charset=utf-8'
  // .pte and anything else: opaque binary blob.
  return 'application/octet-stream'
}

llmRoute.get('/:model/:file', async (c) => {
  const model = c.req.param('model')
  const file = c.req.param('file')

  const allowedFiles = ALLOWED_MODELS[model]
  if (!allowedFiles || !allowedFiles.has(file)) {
    throw new HTTPException(404, {
      message: 'llm_artifact_not_found',
      cause: 'llm_artifact_not_found',
    })
  }

  const key = `${model}/${file}`
  const obj = await c.env.MODEL_BUCKET.get(key)
  if (!obj) {
    // Allowlisted path but the bucket has not been populated. Surface 502 so
    // we don't poison the edge cache with a 404 — re-uploads must take
    // effect immediately.
    throw new HTTPException(502, {
      message: 'llm_artifact_missing_from_bucket',
      cause: 'llm_artifact_missing_from_bucket',
    })
  }

  return new Response(obj.body, {
    headers: {
      'content-type': contentTypeFor(file),
      'content-length': obj.size.toString(),
      etag: obj.httpEtag,
      // The path is versioned implicitly by the model namespace; same key =
      // same bytes, forever. Long, immutable cache lets Cloudflare's edge
      // serve the tokenizer JSONs from POP without re-hitting R2.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
})
