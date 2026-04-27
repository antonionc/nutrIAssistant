// Clears any TheMealDB image URLs that were stored on user_created (seed)
// recipes in earlier builds. These images were copied from random TheMealDB
// entries and did not match the recipe name. After this migration the field
// is NULL for affected seed recipes.
export const migration004 = `
UPDATE recipes
SET    image_url  = NULL,
       updated_at = datetime('now')
WHERE  source_api = 'user_created'
  AND  image_url LIKE '%themealdb.com%';
`
