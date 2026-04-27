// EN → ES dictionary for common ingredient names.
// Keys are lowercase English names; values are Spanish equivalents.
const INGREDIENT_MAP: Record<string, string> = {
  // Vegetables
  'tomato': 'Tomate', 'tomatoes': 'Tomates', 'cherry tomatoes': 'Tomates Cherry',
  'onion': 'Cebolla', 'onions': 'Cebollas', 'red onion': 'Cebolla Morada',
  'spring onion': 'Cebolla Tierna', 'spring onions': 'Cebollas Tiernas', 'shallot': 'Chalota', 'shallots': 'Chalotas',
  'garlic': 'Ajo', 'garlic clove': 'Diente de Ajo', 'garlic cloves': 'Dientes de Ajo',
  'carrot': 'Zanahoria', 'carrots': 'Zanahorias',
  'potato': 'Patata', 'potatoes': 'Patatas', 'sweet potato': 'Boniato', 'sweet potatoes': 'Boniatos',
  'pepper': 'Pimiento', 'peppers': 'Pimientos',
  'red pepper': 'Pimiento Rojo', 'red peppers': 'Pimientos Rojos',
  'green pepper': 'Pimiento Verde', 'green peppers': 'Pimientos Verdes',
  'yellow pepper': 'Pimiento Amarillo', 'yellow peppers': 'Pimientos Amarillos',
  'chilli': 'Chile', 'chilli pepper': 'Chile', 'red chilli': 'Chile Rojo', 'green chilli': 'Chile Verde',
  'chili': 'Chile', 'red chili': 'Chile Rojo', 'green chili': 'Chile Verde', 'jalapeño': 'Jalapeño', 'jalapeno': 'Jalapeño',
  'spinach': 'Espinacas', 'broccoli': 'Brócoli', 'cauliflower': 'Coliflor',
  'lettuce': 'Lechuga', 'cucumber': 'Pepino', 'courgette': 'Calabacín', 'zucchini': 'Calabacín',
  'eggplant': 'Berenjena', 'aubergine': 'Berenjena',
  'mushroom': 'Champiñón', 'mushrooms': 'Champiñones',
  'leek': 'Puerro', 'leeks': 'Puerros', 'celery': 'Apio', 'asparagus': 'Espárragos',
  'peas': 'Guisantes', 'corn': 'Maíz', 'sweetcorn': 'Maíz Dulce', 'avocado': 'Aguacate',
  'kale': 'Col Rizada', 'cabbage': 'Col', 'brussels sprouts': 'Coles de Bruselas',
  'artichoke': 'Alcachofa', 'artichokes': 'Alcachofas',
  'pumpkin': 'Calabaza', 'squash': 'Calabaza', 'butternut squash': 'Calabaza Mantequilla',
  'radish': 'Rábano', 'radishes': 'Rábanos', 'beetroot': 'Remolacha', 'beet': 'Remolacha',
  'fennel': 'Hinojo', 'turnip': 'Nabo', 'parsnip': 'Chirivía',
  // Fruits
  'lemon': 'Limón', 'lemons': 'Limones', 'lime': 'Lima', 'limes': 'Limas',
  'orange': 'Naranja', 'oranges': 'Naranjas', 'apple': 'Manzana', 'apples': 'Manzanas',
  'banana': 'Plátano', 'bananas': 'Plátanos', 'strawberry': 'Fresa', 'strawberries': 'Fresas',
  'grape': 'Uva', 'grapes': 'Uvas', 'peach': 'Melocotón', 'peaches': 'Melocotones',
  'pear': 'Pera', 'pears': 'Peras', 'mango': 'Mango', 'pineapple': 'Piña',
  'coconut': 'Coco', 'ginger': 'Jengibre', 'pomegranate': 'Granada',
  'blueberry': 'Arándano', 'blueberries': 'Arándanos', 'raspberry': 'Frambuesa', 'raspberries': 'Frambuesas',
  'blackberry': 'Mora', 'blackberries': 'Moras', 'cherry': 'Cereza', 'cherries': 'Cerezas',
  // Proteins
  'chicken': 'Pollo', 'chicken breast': 'Pechuga de Pollo', 'chicken breasts': 'Pechugas de Pollo',
  'chicken thighs': 'Muslos de Pollo', 'chicken thigh': 'Muslo de Pollo',
  'chicken wings': 'Alitas de Pollo', 'chicken legs': 'Contramuslos de Pollo',
  'beef': 'Ternera', 'minced beef': 'Carne Picada de Ternera', 'ground beef': 'Carne Picada de Ternera',
  'steak': 'Filete', 'pork': 'Cerdo', 'pork belly': 'Panceta de Cerdo',
  'lamb': 'Cordero', 'lamb chops': 'Chuletas de Cordero', 'lamb mince': 'Carne Picada de Cordero',
  'salmon': 'Salmón', 'tuna': 'Atún', 'cod': 'Bacalao', 'haddock': 'Eglefino',
  'sea bass': 'Lubina', 'sea bream': 'Dorada', 'trout': 'Trucha', 'mackerel': 'Caballa',
  'prawns': 'Gambas', 'shrimp': 'Gambas', 'squid': 'Calamar', 'mussels': 'Mejillones',
  'clams': 'Almejas', 'scallops': 'Vieiras', 'lobster': 'Langosta', 'crab': 'Cangrejo',
  'anchovies': 'Anchoas', 'sardines': 'Sardinas', 'smoked salmon': 'Salmón Ahumado',
  'egg': 'Huevo', 'eggs': 'Huevos',
  'bacon': 'Bacon', 'ham': 'Jamón', 'chorizo': 'Chorizo', 'sausage': 'Salchicha', 'sausages': 'Salchichas',
  'turkey': 'Pavo', 'duck': 'Pato',
  'lentils': 'Lentejas', 'red lentils': 'Lentejas Rojas', 'green lentils': 'Lentejas Verdes',
  'chickpeas': 'Garbanzos', 'beans': 'Judías',
  'black beans': 'Judías Negras', 'kidney beans': 'Alubias Rojas',
  'white beans': 'Judías Blancas', 'cannellini beans': 'Alubias Cannellini',
  'tofu': 'Tofu', 'tempeh': 'Tempeh',
  // Dairy
  'milk': 'Leche', 'butter': 'Mantequilla', 'cream': 'Nata',
  'double cream': 'Nata para Montar', 'single cream': 'Nata Líquida', 'heavy cream': 'Nata para Montar',
  'cheese': 'Queso', 'cheddar': 'Queso Cheddar', 'mozzarella': 'Mozzarella',
  'parmesan': 'Parmesano', 'ricotta': 'Ricotta', 'feta': 'Queso Feta', 'brie': 'Brie',
  'cream cheese': 'Queso Crema', 'yogurt': 'Yogur', 'yoghurt': 'Yogur',
  'sour cream': 'Crema Agria', 'crème fraîche': 'Crème Fraîche',
  'condensed milk': 'Leche Condensada', 'evaporated milk': 'Leche Evaporada',
  'mascarpone': 'Mascarpone', 'goat cheese': 'Queso de Cabra',
  // Grains & Pantry
  'rice': 'Arroz', 'basmati rice': 'Arroz Basmati', 'brown rice': 'Arroz Integral',
  'arborio rice': 'Arroz Arborio', 'jasmine rice': 'Arroz Jazmín',
  'pasta': 'Pasta', 'spaghetti': 'Espaguetis', 'penne': 'Penne', 'fusilli': 'Fusilli',
  'tagliatelle': 'Tagliatelle', 'lasagne': 'Lasaña', 'lasagna': 'Lasaña',
  'fettuccine': 'Fettuccine', 'linguine': 'Linguine', 'rigatoni': 'Rigatoni',
  'bread': 'Pan', 'sourdough': 'Pan de Masa Madre', 'pitta bread': 'Pan de Pita', 'pita bread': 'Pan de Pita',
  'flour': 'Harina', 'plain flour': 'Harina de Todo Uso', 'self-raising flour': 'Harina con Levadura',
  'bread flour': 'Harina de Fuerza', 'cornflour': 'Maicena', 'cornstarch': 'Maicena',
  'oats': 'Avena', 'rolled oats': 'Copos de Avena',
  'breadcrumbs': 'Pan Rallado', 'tortilla': 'Tortilla', 'noodles': 'Fideos',
  'rice noodles': 'Fideos de Arroz', 'egg noodles': 'Fideos de Huevo',
  'quinoa': 'Quinoa', 'couscous': 'Cuscús', 'polenta': 'Polenta',
  'semolina': 'Sémola', 'barley': 'Cebada', 'bulgur': 'Bulgur',
  // Oils, Sauces & Condiments
  'olive oil': 'Aceite de Oliva', 'vegetable oil': 'Aceite Vegetal',
  'sunflower oil': 'Aceite de Girasol', 'sesame oil': 'Aceite de Sésamo',
  'coconut oil': 'Aceite de Coco', 'rapeseed oil': 'Aceite de Colza',
  'soy sauce': 'Salsa de Soja', 'soya sauce': 'Salsa de Soja',
  'worcestershire sauce': 'Salsa Worcestershire', 'tabasco': 'Tabasco',
  'hot sauce': 'Salsa Picante', 'chilli sauce': 'Salsa de Chile', 'chili sauce': 'Salsa de Chile',
  'fish sauce': 'Salsa de Pescado', 'oyster sauce': 'Salsa de Ostras',
  'hoisin sauce': 'Salsa Hoisin', 'teriyaki sauce': 'Salsa Teriyaki',
  'tomato sauce': 'Salsa de Tomate', 'tomato puree': 'Concentrado de Tomate',
  'tomato paste': 'Pasta de Tomate', 'passata': 'Passata',
  'chopped tomatoes': 'Tomates Troceados', 'canned tomatoes': 'Tomates en Lata',
  'tinned tomatoes': 'Tomates en Lata',
  'vinegar': 'Vinagre', 'sherry vinegar': 'Vinagre de Jerez',
  'balsamic vinegar': 'Vinagre Balsámico', 'red wine vinegar': 'Vinagre de Vino Tinto',
  'white wine vinegar': 'Vinagre de Vino Blanco', 'apple cider vinegar': 'Vinagre de Manzana',
  'honey': 'Miel', 'maple syrup': 'Sirope de Arce', 'golden syrup': 'Sirope Dorado',
  'sugar': 'Azúcar', 'brown sugar': 'Azúcar Moreno', 'caster sugar': 'Azúcar Fino',
  'icing sugar': 'Azúcar Glas', 'powdered sugar': 'Azúcar Glas',
  'salt': 'Sal', 'sea salt': 'Sal Marina', 'kosher salt': 'Sal Gruesa',
  'black pepper': 'Pimienta Negra', 'white pepper': 'Pimienta Blanca',
  'mustard': 'Mostaza', 'dijon mustard': 'Mostaza Dijon', 'wholegrain mustard': 'Mostaza en Grano',
  'mayonnaise': 'Mayonesa', 'ketchup': 'Ketchup', 'pesto': 'Pesto',
  'tahini': 'Tahini', 'miso': 'Miso', 'miso paste': 'Pasta Miso',
  'stock': 'Caldo', 'chicken stock': 'Caldo de Pollo', 'beef stock': 'Caldo de Ternera',
  'vegetable stock': 'Caldo de Verduras', 'fish stock': 'Caldo de Pescado',
  'chicken broth': 'Caldo de Pollo', 'beef broth': 'Caldo de Ternera',
  'coconut milk': 'Leche de Coco', 'coconut cream': 'Crema de Coco',
  'almond milk': 'Leche de Almendras', 'soy milk': 'Leche de Soja', 'oat milk': 'Leche de Avena',
  'water': 'Agua', 'sparkling water': 'Agua Con Gas',
  'white wine': 'Vino Blanco', 'red wine': 'Vino Tinto', 'rose wine': 'Vino Rosado',
  'beer': 'Cerveza', 'rum': 'Ron', 'brandy': 'Brandy',
  'lemon juice': 'Zumo de Limón', 'lime juice': 'Zumo de Lima', 'orange juice': 'Zumo de Naranja',
  // Herbs & Spices
  'cumin': 'Comino', 'ground cumin': 'Comino Molido', 'cumin seeds': 'Semillas de Comino',
  'paprika': 'Pimentón', 'smoked paprika': 'Pimentón Ahumado', 'sweet paprika': 'Pimentón Dulce',
  'turmeric': 'Cúrcuma', 'ground turmeric': 'Cúrcuma Molida',
  'coriander': 'Cilantro', 'ground coriander': 'Cilantro Molido', 'coriander seeds': 'Semillas de Cilantro',
  'cinnamon': 'Canela', 'ground cinnamon': 'Canela Molida', 'cinnamon stick': 'Rama de Canela',
  'chilli powder': 'Chile en Polvo', 'chili powder': 'Chile en Polvo',
  'cayenne pepper': 'Cayena', 'cayenne': 'Cayena',
  'oregano': 'Orégano', 'dried oregano': 'Orégano Seco',
  'thyme': 'Tomillo', 'dried thyme': 'Tomillo Seco', 'fresh thyme': 'Tomillo Fresco',
  'rosemary': 'Romero', 'dried rosemary': 'Romero Seco', 'fresh rosemary': 'Romero Fresco',
  'basil': 'Albahaca', 'fresh basil': 'Albahaca Fresca', 'dried basil': 'Albahaca Seca',
  'parsley': 'Perejil', 'fresh parsley': 'Perejil Fresco', 'dried parsley': 'Perejil Seco',
  'bay leaf': 'Hoja de Laurel', 'bay leaves': 'Hojas de Laurel',
  'mint': 'Menta', 'fresh mint': 'Menta Fresca',
  'dill': 'Eneldo', 'fresh dill': 'Eneldo Fresco',
  'tarragon': 'Estragón', 'sage': 'Salvia', 'chives': 'Cebollino',
  'cardamom': 'Cardamomo', 'ground cardamom': 'Cardamomo Molido',
  'cloves': 'Clavos', 'ground cloves': 'Clavos Molidos',
  'nutmeg': 'Nuez Moscada', 'ground nutmeg': 'Nuez Moscada Molida',
  'allspice': 'Pimienta de Jamaica', 'star anise': 'Anís Estrellado',
  'fennel seeds': 'Semillas de Hinojo', 'mustard seeds': 'Semillas de Mostaza',
  'sesame seeds': 'Semillas de Sésamo', 'poppy seeds': 'Semillas de Amapola',
  'caraway seeds': 'Semillas de Alcaravea', 'nigella seeds': 'Semillas de Nigela',
  'mixed spice': 'Especias Mixtas', 'five spice': 'Cinco Especias', 'garam masala': 'Garam Masala',
  'curry powder': 'Curry en Polvo', 'ras el hanout': 'Ras el Hanout',
  'saffron': 'Azafrán', 'vanilla': 'Vainilla', 'vanilla extract': 'Extracto de Vainilla',
  'vanilla pod': 'Vaina de Vainilla',
  'baking powder': 'Levadura en Polvo', 'baking soda': 'Bicarbonato', 'bicarbonate of soda': 'Bicarbonato',
  'yeast': 'Levadura', 'dried yeast': 'Levadura Seca', 'instant yeast': 'Levadura Instantánea',
  // Nuts, Seeds & Dried Fruits
  'almonds': 'Almendras', 'almond': 'Almendra', 'ground almonds': 'Almendras Molidas',
  'walnuts': 'Nueces', 'walnut': 'Nuez', 'peanuts': 'Cacahuetes', 'peanut': 'Cacahuete',
  'cashews': 'Anacardos', 'cashew': 'Anacardo', 'cashew nuts': 'Anacardos',
  'pine nuts': 'Piñones', 'pistachios': 'Pistachos', 'pistachio': 'Pistacho',
  'hazelnuts': 'Avellanas', 'hazelnut': 'Avellana', 'pecans': 'Pacanas',
  'macadamia nuts': 'Macadamias', 'sunflower seeds': 'Semillas de Girasol',
  'pumpkin seeds': 'Pepitas de Calabaza', 'chia seeds': 'Semillas de Chía',
  'flaxseeds': 'Semillas de Lino', 'linseeds': 'Semillas de Lino',
  'raisins': 'Pasas', 'sultanas': 'Sultanas', 'currants': 'Grosellas Pasas',
  'dates': 'Dátiles', 'dried apricots': 'Albaricoques Secos',
  'prunes': 'Ciruelas Pasas', 'cranberries': 'Arándanos Rojos',
  // Other Common Ingredients
  'olives': 'Aceitunas', 'black olives': 'Aceitunas Negras', 'green olives': 'Aceitunas Verdes',
  'capers': 'Alcaparras',
  'sun-dried tomatoes': 'Tomates Secos', 'dried tomatoes': 'Tomates Secos',
  'roasted peppers': 'Pimientos Asados', 'artichoke hearts': 'Corazones de Alcachofa',
  'peanut butter': 'Mantequilla de Cacahuete', 'almond butter': 'Mantequilla de Almendras',
  'jam': 'Mermelada', 'marmalade': 'Mermelada de Naranja',
  'chocolate': 'Chocolate', 'dark chocolate': 'Chocolate Negro',
  'milk chocolate': 'Chocolate con Leche', 'white chocolate': 'Chocolate Blanco',
  'cocoa powder': 'Cacao en Polvo', 'cocoa': 'Cacao',
  'gelatine': 'Gelatina', 'gelatin': 'Gelatina',
  'cornmeal': 'Harina de Maíz', 'oatmeal': 'Harina de Avena',
  'lard': 'Manteca', 'ghee': 'Ghee',
  'soda water': 'Agua con Gas', 'stock cube': 'Pastilla de Caldo', 'stock cubes': 'Pastillas de Caldo',
  'bouillon cube': 'Pastilla de Caldo', 'bouillon cubes': 'Pastillas de Caldo',
  'mixed herbs': 'Hierbas Mixtas', 'herbes de provence': 'Hierbas de Provenza',
  'za\'atar': 'Za\'atar', 'sumac': 'Sumac',
  'spirulina': 'Espirulina', 'matcha': 'Matcha',
}

// Units / measurement terms EN → ES
const UNIT_MAP: Record<string, string> = {
  'units': 'unidades', 'unit': 'unidad', 'pieces': 'piezas', 'piece': 'pieza',
  'tablespoon': 'cucharada', 'tablespoons': 'cucharadas', 'tbsp': 'cda.',
  'teaspoon': 'cucharadita', 'teaspoons': 'cucharaditas', 'tsp': 'cdta.',
  'cup': 'taza', 'cups': 'tazas',
  'handful': 'puñado', 'handfuls': 'puñados',
  'bunch': 'manojo', 'bunches': 'manojos',
  'sprig': 'ramita', 'sprigs': 'ramitas',
  'clove': 'diente', 'cloves': 'dientes',
  'slice': 'rodaja', 'slices': 'rodajas',
  'strip': 'tira', 'strips': 'tiras',
  'chopped': 'picado', 'diced': 'en dados', 'sliced': 'en rodajas',
  'grated': 'rallado', 'minced': 'picado fino', 'crushed': 'machacado',
  'peeled': 'pelado', 'halved': 'partido por la mitad',
  'juice of': 'zumo de', 'juice of 1/2': 'zumo de 1/2', 'juice of 1': 'zumo de 1',
  'zest of': 'ralladura de',
  'to taste': 'al gusto',
  'as needed': 'cantidad necesaria',
}

/**
 * Returns the Spanish translation of a common English ingredient name.
 * Falls back to the original name if no translation is found.
 */
export function translateIngredient(name: string): string {
  const key = name.trim().toLowerCase()
  // Try exact match first
  if (INGREDIENT_MAP[key]) return INGREDIENT_MAP[key]
  // Try removing trailing 's' for simple plurals not explicitly mapped
  if (key.endsWith('s') && INGREDIENT_MAP[key.slice(0, -1)]) {
    return INGREDIENT_MAP[key.slice(0, -1)]
  }
  return name // fall back to original
}

/**
 * Returns the Spanish translation of a unit/measurement string.
 * Handles compound unit strings like "clove peeled crushed" by translating
 * each known word. Falls back to the original for unknown terms.
 */
export function translateUnit(unit: string): string {
  const trimmed = unit.trim()
  const lower = trimmed.toLowerCase()

  // Exact match
  if (UNIT_MAP[lower]) return UNIT_MAP[lower]

  // Word-by-word substitution for compound units
  const translated = lower
    .split(/\s+/)
    .map((word) => UNIT_MAP[word] ?? word)
    .join(' ')

  // Capitalise first letter only if we actually changed something
  if (translated !== lower) {
    return translated.charAt(0).toUpperCase() + translated.slice(1)
  }
  return trimmed
}
