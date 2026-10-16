// Check for pricing.js: node src/materials/pricing.check.mjs
import assert from 'node:assert/strict';
import { parseDecimal, priceBreakdown } from './pricing.js';

assert.equal(parseDecimal('1,5'), 1.5);
assert.equal(parseDecimal('1.5'), 1.5);
assert.equal(parseDecimal('1.234,50'), 1234.5);
assert.equal(parseDecimal(' '), null);
assert.ok(Number.isNaN(parseDecimal('abc')));
assert.deepEqual(priceBreakdown(36, 45), { net: 1620, vat: 356.4, total: 1976.4 });
assert.deepEqual(priceBreakdown(2.5, 10, 10), { net: 25, vat: 2.5, total: 27.5 });
assert.deepEqual(priceBreakdown(1, 10, null), { net: 10, vat: 2.2, total: 12.2 });
console.log('pricing: ok');
