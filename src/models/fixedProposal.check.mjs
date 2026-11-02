// Check for fixedProposal.js: node src/models/fixedProposal.check.mjs
import assert from 'node:assert/strict';
import { fixedProposal } from './fixedProposal.js';

assert.equal(fixedProposal('kitchens', [0.6, 0.9, 0.6]), true);       // kitchen unit: fixed
assert.equal(fixedProposal('bathroom', [0.5, 0.4, 0.6]), true);       // toilet: fixed
assert.equal(fixedProposal('seating', [0.5, 0.9, 0.5]), false);       // chair: movable
assert.equal(fixedProposal('storage', [2.4, 2.2, 0.6]), true);        // wardrobe (a side > 1.5 m): fixed
assert.equal(fixedProposal('storage', [0.5, 0.6, 0.4]), false);       // nightstand: movable
assert.equal(fixedProposal('seating', [2.8, 0.9, 1]), false);         // a long sofa stays movable
console.log('fixedProposal: ok');
