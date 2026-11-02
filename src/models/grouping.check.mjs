// Check for grouping.js: node src/models/grouping.check.mjs
import assert from 'node:assert/strict';
import { brandsOf, categoriesWith, modelsIn, searchModels, subtypesIn } from './grouping.js';

const model = (id, brand, category, subtype, codes = []) => ({ id, name: id, brand, category, subtype, variants: codes.map((code) => ({ code })) });
const list = [
    model('Oslo Chair', 'Nordic', 'seating', 'chair', ['NC-100', 'NC-101']),
    model('Milano Sofa', 'arredo', 'seating', 'sofa', ['AR-7']),
    model('Odd Seat', 'Nordic', 'seating', 'hammock'),          // unlisted subtype -> Other
    model('Big Wardrobe', 'arredo', 'storage', 'wardrobe'),
    model('Mystery', 'Nordic', 'spaceship', 'x')                 // unlisted category: search only
];
const ids = (items) => items.map((item) => item.id);

// categories: only the ones with models, catalog order, Basic shapes always last
assert.deepEqual(ids(categoriesWith(list)), ['seating', 'storage', 'shapes']);
assert.deepEqual(ids(categoriesWith([])), ['shapes']);
// brand filter narrows categories, chips and models (AE5)
assert.deepEqual(ids(categoriesWith(list, 'Nordic')), ['seating', 'shapes']);
assert.deepEqual(ids(subtypesIn(list, 'seating')), ['chair', 'sofa', 'other']);
assert.deepEqual(ids(subtypesIn(list, 'seating', 'arredo')), ['sofa']);
assert.deepEqual(ids(modelsIn(list, { category: 'seating', subtype: 'other' })), ['Odd Seat']);
assert.deepEqual(ids(modelsIn(list, { category: 'seating', brand: 'Nordic' })), ['Oslo Chair', 'Odd Seat']);
// brands: distinct, alphabetical regardless of case
assert.deepEqual(brandsOf(list), ['arredo', 'Nordic']);
// search: name (any case), variant code, whole catalog, within the brand if set
assert.deepEqual(ids(searchModels(list, ' oslo ')), ['Oslo Chair']);
assert.deepEqual(ids(searchModels(list, 'ar-7')), ['Milano Sofa']);
assert.deepEqual(ids(searchModels(list, 'mystery')), ['Mystery']);
assert.deepEqual(ids(searchModels(list, 'o', 'arredo')), ['Milano Sofa', 'Big Wardrobe']);
assert.deepEqual(searchModels(list, '  '), []);
console.log('grouping: ok');
