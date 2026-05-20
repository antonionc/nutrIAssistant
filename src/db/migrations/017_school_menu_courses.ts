// Migration 017 — structured courses on school_menu_entries.
//
// Spanish school menus follow a three-course structure (primer plato,
// segundo plato, postre). Three nullable columns persist the structured
// output; `description` stays as a fallback when the parser can't tell
// the courses apart. NULL on a course column means "not identified" — the
// UI renders "Sin datos" for that course.
export const migration017 = `
ALTER TABLE school_menu_entries ADD COLUMN first_course TEXT;
ALTER TABLE school_menu_entries ADD COLUMN second_course TEXT;
ALTER TABLE school_menu_entries ADD COLUMN dessert TEXT;
`
