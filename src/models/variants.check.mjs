// Check for variants.js: node src/models/variants.check.mjs
import assert from 'node:assert/strict';
import { materialChanges, materialLabel, variantKey, variantOf, variantPriceKey, variantTint, variantsLabel, withVariantPrice } from './variants.js';

const model = {
    id: 'chair',
    variants: [
        { id: 'oak', overrides: {} },
        { id: 'blue', overrides: { fabric: { tint: '#3355aa' } } },
        { id: 'print', overrides: { fabric: { map: 'models/system/chair/tex-1.webp' } } }
    ]
};
const names = ['wood', 'fabric'];

// no overrides: every material as in the GLB
assert.deepEqual(materialChanges(names, variantOf(model, 'oak')), [null, null]);
// tint on "fabric": only that material changes
assert.deepEqual(materialChanges(names, variantOf(model, 'blue')), [null, { tint: '#3355aa' }]);
// texture: replaces the map only where given
assert.deepEqual(materialChanges(names, variantOf(model, 'print')), [null, { map: 'models/system/chair/tex-1.webp' }]);
// unknown variant id -> first variant
assert.equal(variantOf(model, 'gone').id, 'oak');
assert.equal(variantOf(model, undefined).id, 'oak');
// an override for a material the GLB does not have changes nothing
assert.deepEqual(materialChanges(['wood'], variantOf(model, 'blue')), [null]);
// cache key changes when the owner edits a variant (same id, new overrides)
assert.notEqual(variantKey(model, model.variants[1]), variantKey(model, { id: 'blue', overrides: { fabric: { tint: '#000000' } } }));
// swatch: first tint, none for a texture-only variant
assert.equal(variantTint(model.variants[1]), '#3355aa');
assert.equal(variantTint(model.variants[2]), null);
assert.equal(variantTint({ swatch: '#111111', overrides: { fabric: { tint: '#3355aa' } } }), '#111111', 'picked color wins');

// labels: the owner's name, else the GLB name tidied; the card names what the variants change
assert.equal(materialLabel({ materialLabels: { fabric: 'Leather' } }, 'fabric'), 'Leather');
assert.equal(materialLabel({}, 'chair_01_pillow'), 'Chair 01 pillow');
assert.equal(variantsLabel({ ...model, materialLabels: { fabric: 'Leather' } }), 'Leather');
assert.equal(variantsLabel({ variants: [{ overrides: { a: { tint: '#000000' } } }, { overrides: { b: { tint: '#000000' } } }] }), 'A / B');
assert.equal(variantsLabel({ variants: [{ overrides: {} }] }), 'Variant');

// frozen prices (AE4): oak -> walnut freezes walnut and leaves oak as it was
const chair = {
    id: 'chair', name: 'Chair', brand: 'Acme', url: '',
    variants: [{ id: 'oak', name: 'Oak', code: 'C-1', price: 120, vatRate: 22 }, { id: 'walnut', name: 'Walnut', price: 150 }, { id: 'raw', name: 'Raw' }]
};
const first = withVariantPrice({}, chair, 'oak');
assert.deepEqual(first[variantPriceKey('chair', 'oak')], { name: 'Chair', code: 'C-1', url: null, price: 120, vatRate: 22, waste: null, brand: 'Acme', variant: 'Oak' });
chair.variants[0].price = 130; // the price list changes later
const second = withVariantPrice(withVariantPrice(first, chair, 'oak'), chair, 'walnut');
assert.equal(second['model:chair:oak'].price, 120, 'already frozen: not overwritten');
assert.equal(second['model:chair:walnut'].price, 150);
// no price, unknown variant or unknown model: same object back
assert.equal(withVariantPrice(second, chair, 'raw'), second);
assert.equal(withVariantPrice(second, chair, 'gone'), second);
assert.equal(withVariantPrice(second, null, 'oak'), second);
console.log('variants: ok');
