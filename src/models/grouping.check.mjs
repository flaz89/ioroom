// Check for grouping.js: node src/models/grouping.check.mjs
import assert from 'node:assert/strict';
import { brandsOf, categoriesWith, familyName, groupFamilies, modelsIn, searchModels, subtypesIn } from './grouping.js';

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

// families: one item per brand + family with 2+ modules, at its first module's place; single = the model
const mod = (id, brand, family) => ({ ...model(id, brand, 'seating', 'sofa'), family });
const sofas = [mod('Spacer triple', 'Dondi', 'Spacer'), mod('Bellini', 'Heller', null), mod('Spacer chaise', 'Dondi', 'Spacer'),
    mod('Lone', 'Dondi', 'Solo'), mod('Spacer other', 'Acme', 'Spacer')];
const grid = groupFamilies(sofas);
assert.equal(grid.length, 4);
assert.deepEqual(ids(grid[0].models), ['Spacer triple', 'Spacer chaise']);
assert.deepEqual(ids(grid.slice(1)), ['Bellini', 'Lone', 'Spacer other']);
assert.deepEqual(ids(searchModels(sofas, 'spacer', 'Dondi')), ['Spacer triple', 'Spacer chaise']);
// name of a family made by dropping a tile on another
assert.equal(familyName({ name: 'Spacer double_seat' }, { name: 'Spacer triple_seat' }), 'Spacer');
assert.equal(familyName({ name: 'A' }, { name: 'B' }), 'B');
assert.equal(familyName({ name: 'A', family: 'X' }, { name: 'B' }), 'X');
assert.equal(familyName({ name: 'A', family: 'X' }, { name: 'B', family: 'Y' }), 'Y');
console.log('grouping: ok');
