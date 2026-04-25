// Adds from_meal_plan to grocery_items for devices whose table was created before this column existed
export const migration006 = 'ALTER TABLE grocery_items ADD COLUMN from_meal_plan INTEGER NOT NULL DEFAULT 0;'
