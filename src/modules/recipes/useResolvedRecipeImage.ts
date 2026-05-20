import { useEffect, useState } from 'react'
import { Recipe } from '../../types/recipes'
import { getRecipeById } from './recipeDB'
import { enrichRecipeDetail, enrichSpoonacularDetail } from './syncRecipes'

// Module-level cache of resolved thumbnail URLs, keyed by recipe id. Survives
// component unmount/remount so a card that lazy-enriched a thumbnail renders
// it instantly on the next mount. Meal-plan snapshots aren't rewritten when
// the live `recipes` row is enriched, so without this cache every remount
// would re-walk the DB and possibly re-enrich.
const resolvedImageCache = new Map<string, string>()

function rememberResolvedImage(recipeId: string, url: string | undefined): void {
  if (!url) return
  resolvedImageCache.set(recipeId, url)
}

/**
 * Resolves the thumbnail URL for a recipe (catalog row, meal-plan snapshot,
 * or any other carrier of the `Recipe` shape).
 *
 * Resolution paths, tried in order:
 *   1. The recipe already has `imageUrl` — fast path, no DB roundtrip.
 *   2. The module-level cache has a previously-resolved URL for this
 *      recipe id — instant on remount.
 *   3. The live catalog row has it — happens when the recipe was
 *      enriched after the snapshot was first created.
 *   4. Both inputs are stubs — kicks off the same lazy
 *      `enrichRecipeDetail` / `enrichSpoonacularDetail` flow the detail
 *      screen uses, then re-reads.
 */
export function useResolvedRecipeImage(recipe: Recipe | undefined): string | undefined {
  const [imageUrl, setImageUrl] = useState<string | undefined>(() => {
    if (!recipe) return undefined
    return recipe.imageUrl ?? resolvedImageCache.get(recipe.id)
  })

  // Dep is ONLY `recipe?.id` — a later `imageUrl: undefined` (e.g. plan
  // reloaded before the catalog row caught up) must not flash the image off.
  useEffect(() => {
    if (!recipe) {
      setImageUrl(undefined)
      return
    }

    // 1. Snapshot has it — use directly, and remember for next mount.
    if (recipe.imageUrl) {
      setImageUrl(recipe.imageUrl)
      rememberResolvedImage(recipe.id, recipe.imageUrl)
      return
    }

    // 2. Module cache has a previously-resolved URL — show it now so
    //    the user sees a thumbnail immediately, but still revalidate
    //    against the DB in case it changed.
    const cached = resolvedImageCache.get(recipe.id)
    if (cached) {
      setImageUrl(cached)
    } else {
      // Truly nothing cached — clear any image carried over from a
      // previous recipe slot before the async resolution lands.
      setImageUrl(undefined)
    }

    let cancelled = false
    void (async () => {
      // 3. Check the live recipes row — it may have been enriched during
      //    a previous session.
      const live = await getRecipeById(recipe.id)
      if (cancelled) return
      if (live?.imageUrl) {
        setImageUrl(live.imageUrl)
        rememberResolvedImage(recipe.id, live.imageUrl)
        return
      }

      // 4. Still a stub — trigger the same lazy enrichment the detail
      //    screen does, so the thumbnail appears the first time the
      //    user lands on a freshly-synced list instead of waiting until
      //    they open the recipe detail.
      if (!live?.sourceId) return
      const ok =
        live.sourceApi === 'edamam'
          ? await enrichRecipeDetail(live.id, live.sourceId)
          : live.sourceApi === 'spoonacular'
            ? await enrichSpoonacularDetail(live.id, live.sourceId)
            : false
      if (cancelled || !ok) return
      const refreshed = await getRecipeById(recipe.id)
      if (cancelled) return
      if (refreshed?.imageUrl) {
        setImageUrl(refreshed.imageUrl)
        rememberResolvedImage(recipe.id, refreshed.imageUrl)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.id])

  return imageUrl
}
