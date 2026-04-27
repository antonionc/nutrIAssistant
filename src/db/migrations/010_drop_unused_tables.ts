// Removes tables that were scaffolded in the initial schema but have never
// been read or written by any feature. Reclaims ~2 KB of schema overhead.
export const migration010 = `
DROP TABLE IF EXISTS retailer_connections;
DROP TABLE IF EXISTS usda_cache;
`
