// Check for grouping.js: node src/materials/grouping.check.mjs
import assert from 'node:assert/strict';
import { kindsIn, visibleMaterials } from './grouping.js';

const list = [
    { id: 'plain', category: null },
    { id: 'oak', category: 'floor', kind: 'wood' },
    { id: 'carrara', category: 'floor', kind: 'marble' },
    { id: 'old', category: 'floor' },                    // no kind -> Other
    { id: 'odd', category: 'floor', kind: 'unknown-kind' }, // unlisted -> Other
    { id: 'bricks', category: 'wall', kind: 'brick' }
];
const ids = (materials) => materials.map((m) => m.id);
assert.deepEqual(kindsIn(list, 'floor').map((k) => k.id), ['wood', 'marble', 'other']);
assert.deepEqual(kindsIn(list, 'wall').map((k) => k.id), ['brick']);
assert.deepEqual(ids(visibleMaterials(list, { category: 'floor', kind: null })), ['plain', 'oak', 'carrara', 'old', 'odd']);
assert.deepEqual(ids(visibleMaterials(list, { category: 'floor', kind: 'other' })), ['plain', 'old', 'odd']);
assert.deepEqual(ids(visibleMaterials(list, { category: 'wall', kind: 'wood' })), ['plain']);
console.log('grouping: ok');
