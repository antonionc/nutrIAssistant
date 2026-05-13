// Removes all FatSecret-sourced recipes from the database.
// Edamam (Mediterranean-first) replaces FatSecret as the catalog source —
// the on-device LLM, AI memory, and meal-plan flows are unchanged.
//
// Why a purge rather than an in-place re-source: FatSecret recipe IDs were
// embedded as the `fs-<id>` primary key, so a clean delete is simpler and
// safer than rewriting every PK with the Edamam equivalent.
export const migration013 = `
DELETE FROM recipes WHERE source_api = 'fatsecret';
`
