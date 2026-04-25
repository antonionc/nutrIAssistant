// Adds recipe_id to grocery_items for devices whose table was created before this column existed
export const migration007 = 'ALTER TABLE grocery_items ADD COLUMN recipe_id TEXT;'
