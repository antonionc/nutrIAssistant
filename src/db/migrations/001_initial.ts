export const migration001 = `
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  quantity REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'units',
  expiry_date TEXT,
  added_at TEXT NOT NULL,
  image_url TEXT,
  nutritional_info TEXT,
  barcode TEXT,
  low_stock_threshold REAL
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_es TEXT,
  category TEXT NOT NULL DEFAULT 'dinner',
  cuisine TEXT NOT NULL DEFAULT 'Other',
  cuisine_flag TEXT,
  instructions TEXT NOT NULL DEFAULT '[]',
  instructions_es TEXT,
  ingredients TEXT NOT NULL DEFAULT '[]',
  prep_time INTEGER NOT NULL DEFAULT 0,
  cook_time INTEGER NOT NULL DEFAULT 0,
  servings INTEGER NOT NULL DEFAULT 4,
  image_url TEXT,
  local_image_path TEXT,
  source_api TEXT DEFAULT 'user_created',
  source_id TEXT,
  nutritional_info TEXT NOT NULL DEFAULT '{}',
  allergens TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  family_compatibility TEXT,
  nutriscore TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meal_plans (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  breakfast_recipe_id TEXT,
  lunch_recipe_id TEXT,
  dinner_recipe_id TEXT,
  member_targets TEXT NOT NULL DEFAULT '{}',
  school_menu_context TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS school_menu_entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  child_id TEXT NOT NULL,
  meal TEXT NOT NULL DEFAULT 'lunch',
  description TEXT NOT NULL,
  extracted_ingredients TEXT NOT NULL DEFAULT '[]',
  extracted_allergens TEXT NOT NULL DEFAULT '[]',
  nutritional_estimate TEXT,
  UNIQUE(date, child_id)
);

CREATE TABLE IF NOT EXISTS scan_history (
  id TEXT PRIMARY KEY,
  scan_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  barcode TEXT,
  product_name TEXT,
  brand TEXT,
  image_uri TEXT NOT NULL,
  nutritional_info TEXT,
  nutriscore TEXT,
  allergens TEXT NOT NULL DEFAULT '[]',
  ingredients TEXT,
  family_compatibility TEXT NOT NULL DEFAULT '{}',
  added_to_inventory INTEGER NOT NULL DEFAULT 0,
  added_to_cart INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS grocery_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'units',
  category TEXT NOT NULL DEFAULT 'other',
  notes TEXT,
  is_purchased INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  purchased_at TEXT,
  from_meal_plan INTEGER NOT NULL DEFAULT 0,
  recipe_id TEXT
);

CREATE TABLE IF NOT EXISTS usda_cache (
  fdc_id TEXT PRIMARY KEY,
  ingredient_name TEXT NOT NULL,
  nutritional_info TEXT NOT NULL,
  cached_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usda_name ON usda_cache(ingredient_name);

CREATE TABLE IF NOT EXISTS retailer_connections (
  id TEXT PRIMARY KEY,
  retailer_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  is_connected INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  is_coming_soon INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`
