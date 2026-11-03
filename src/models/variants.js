import { priceSnapshot } from '../materials/pricing.js';

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

// Variant swatch color: the one the owner picked, else its first tint; null = none (neutral dot)
export const variantTint = (variant) => variant?.swatch ?? Object.values(variant?.overrides ?? {}).find((change) => change.tint)?.tint ?? null;

// Name shown for a GLB material: the owner's label (model.materialLabels), else the GLB name tidied up
export const materialLabel = (model, material) => model?.materialLabels?.[material]
    || material.replace(/[_-]+/g, ' ').trim().replace(/^./, (letter) => letter.toUpperCase());

// What the variants of `model` change, for the product card: the labels of the materials any variant
// overrides ("Leather", "Leather / Wood"); 'Variant' when they change nothing (or the model has no names)
export function variantsLabel(model) {
    const materials = [...new Set(model.variants.flatMap((variant) => Object.keys(variant.overrides ?? {})))];
    return materials.length > 0 ? materials.map((material) => materialLabel(model, material)).join(' / ') : 'Variant';
}

/*
* Frozen prices (plan KTD7): furniture shares the project's priceSnapshots with the materials, key
* `model:<modelId>:<variantId>`. The first use of a priced variant in the project copies its card; later
* price-list changes leave it as it was. Returns the new snapshots, or the same object when nothing changes
* (already frozen, unknown variant, no price).
*/
export const variantPriceKey = (modelId, variantId) => `model:${modelId}:${variantId}`;

export function withVariantPrice(snapshots, model, variantId) {
    const variant = model?.variants.find((item) => item.id === variantId);
    const key = variantPriceKey(model?.id, variantId);
    if (variant?.price == null || snapshots[key] != null) return snapshots;
    const snapshot = {
        ...priceSnapshot({ name: model.name, code: variant.code || null, url: model.url || null, price: variant.price, vatRate: variant.vatRate ?? null }),
        brand: model.brand ?? null,
        variant: variant.name
    };
    return { ...snapshots, [key]: snapshot };
}
