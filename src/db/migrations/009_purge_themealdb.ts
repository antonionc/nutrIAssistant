// Removes all TheMealDB-sourced recipes from the database.
// FatSecret (Mediterranean-first) replaces TheMealDB as the remote recipe source.
export const migration009 = `
DELETE FROM recipes WHERE source_api = 'themealdb';
`
