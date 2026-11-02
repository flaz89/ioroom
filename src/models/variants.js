/*
* Furniture variants (plan R5, KTD4), pure: which variant an object shows and what it changes on each
* material of the GLB. A variant changes materials BY NAME: overrides = { <material name>: { tint?, map? } }
* (tint '#rrggbb' multiplies the material color, map = R2 key of the color texture that replaces the
* GLB's own). The three.js side (copies of the materials, textures) is in useModelMesh.js.
*/

// The variant `variantId` of `model`; an unknown id (deleted variant, old scene) falls back to the first
export const variantOf = (model, variantId) => model.variants.find((variant) => variant.id === variantId) ?? model.variants[0];

/*
* Changes for the GLB's materials, in their order: { tint?, map? } for each material the variant changes,
* null for the ones it leaves as in the GLB.
*/
export const materialChanges = (materialNames, variant) => materialNames.map((name) => variant?.overrides?.[name] ?? null);

// Cache key of a variant's materials (shared by every copy of that variant in the scene)
export const variantKey = (model, variant) => `${model.id}:${variant?.id ?? ''}:${JSON.stringify(variant?.overrides ?? {})}`;
