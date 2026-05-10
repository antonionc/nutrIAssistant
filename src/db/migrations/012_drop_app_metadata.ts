// Drops `app_metadata` for existing installs.
//
// The table was created by 001_initial.ts as a generic key/value store but
// no feature ever read or wrote to it. Removing it from 001 alone would
// only affect fresh installs; this migration handles the long tail of
// installs in the wild that already have an empty `app_metadata` table.
//
// Idempotent: `IF EXISTS` makes re-runs harmless.
export const migration012 = `
DROP TABLE IF EXISTS app_metadata;
`
