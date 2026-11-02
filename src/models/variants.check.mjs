// Check for variants.js: node src/models/variants.check.mjs
import assert from 'node:assert/strict';
import { materialChanges, variantKey, variantOf } from './variants.js';

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
console.log('variants: ok');
