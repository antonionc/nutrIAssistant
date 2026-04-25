// Adds purchased_at to grocery_items for devices whose table was created before this column existed
export const migration005 = 'ALTER TABLE grocery_items ADD COLUMN purchased_at TEXT;'
