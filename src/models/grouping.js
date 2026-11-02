/*
* How the furniture catalog is organized in the "+" menu (plan R1–R4): a grid of CATEGORIES (what kind of
* furniture), then the models of one category with chips by SUBTYPE; the MANUFACTURER (record `brand`)
* filters categories and models; the search looks through the whole catalog.
* The lists live only here (the server only checks the shape of the ids): add a category or subtype = add
* a line. A subtype not listed under its category shows under "Other"; a model whose category is not listed
* is found only by the search.
* "Basic shapes" (SHAPES) is a special category, always shown: the primitives of objectsList (objectsSlice.js).
*/
export const SHAPES = 'shapes';

export const MODEL_CATEGORIES = [
    { id: 'seating', label: 'Seating', subtypes: [['chair', 'Chairs'], ['armchair', 'Armchairs'], ['sofa', 'Sofas'], ['stool', 'Stools'], ['bench', 'Benches']] },
    { id: 'tables', label: 'Tables', subtypes: [['dining', 'Dining'], ['coffee', 'Coffee'], ['side', 'Side'], ['desk', 'Desks'], ['console', 'Consoles']] },
    { id: 'storage', label: 'Storage', subtypes: [['wardrobe', 'Wardrobes'], ['sideboard', 'Sideboards'], ['cabinet', 'Cabinets'], ['bookcase', 'Bookcases'], ['drawers', 'Chests of drawers'], ['nightstand', 'Nightstands']] },
    { id: 'beds', label: 'Beds', subtypes: [['double', 'Double'], ['single', 'Single'], ['bunk', 'Bunk'], ['daybed', 'Daybeds']] },
    { id: 'kitchens', label: 'Kitchens', subtypes: [['base', 'Base units'], ['wall-unit', 'Wall units'], ['tall', 'Tall units'], ['island', 'Islands'], ['appliance', 'Appliances']] },
    { id: 'bathroom', label: 'Bathroom', subtypes: [['vanity', 'Vanities'], ['toilet', 'Toilets & bidets'], ['shower', 'Showers'], ['bathtub', 'Bathtubs']] },
    { id: 'lighting', label: 'Lighting', subtypes: [['ceiling', 'Ceiling'], ['floor', 'Floor'], ['table', 'Table'], ['wall', 'Wall']] },
    { id: 'decor', label: 'Decor', subtypes: [['rug', 'Rugs'], ['plant', 'Plants'], ['mirror', 'Mirrors'], ['art', 'Art'], ['curtain', 'Curtains']] },
    { id: 'outdoor', label: 'Outdoor', subtypes: [['seating', 'Seating'], ['tables', 'Tables'], ['shade', 'Umbrellas & shade'], ['planter', 'Planters']] }
].map((category) => ({
    ...category,
    subtypes: [...category.subtypes.map(([id, label]) => ({ id, label })), { id: 'other', label: 'Other' }]
}));

const CATEGORY = new Map(MODEL_CATEGORIES.map((category) => [category.id, category]));

export const SHAPES_CATEGORY = { id: SHAPES, label: 'Basic shapes', subtypes: [] };

// Subtype id of a model: its own if listed under its category, otherwise 'other'
export function subtypeOf(model) {
    const listed = CATEGORY.get(model.category)?.subtypes.some((subtype) => subtype.id === model.subtype);
    return listed ? model.subtype : 'other';
}

const ofBrand = (models, brand) => (brand == null ? models : models.filter((model) => model.brand === brand));

// Categories with at least one model (of `brand`, null = any), in MODEL_CATEGORIES order, then Basic shapes
export function categoriesWith(models, brand = null) {
    const present = new Set(ofBrand(models, brand).map((model) => model.category));
    return [...MODEL_CATEGORIES.filter((category) => present.has(category.id)), SHAPES_CATEGORY];
}

// Subtypes present in a category (the chips worth showing), in the category's order
export function subtypesIn(models, category, brand = null) {
    const present = new Set(ofBrand(models, brand).filter((model) => model.category === category).map(subtypeOf));
    return (CATEGORY.get(category)?.subtypes ?? []).filter((subtype) => present.has(subtype.id));
}

// Models of the grid: one category, one subtype (null = all), one brand (null = any)
export const modelsIn = (models, { category, subtype = null, brand = null }) => ofBrand(models, brand)
    .filter((model) => model.category === category && (subtype == null || subtypeOf(model) === subtype));

// Distinct manufacturers, alphabetical
export const brandsOf = (models) => [...new Set(models.map((model) => model.brand))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

// Models whose name or a variant code contains `text` (any case), within `brand` if set; empty text = none
export function searchModels(models, text, brand = null) {
    const query = text.trim().toLowerCase();
    if (!query) return [];
    const matches = (value) => value?.toLowerCase().includes(query);
    return ofBrand(models, brand).filter((model) => matches(model.name) || model.variants.some((variant) => matches(variant.code)));
}
