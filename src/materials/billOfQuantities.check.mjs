// Check for billOfQuantities.js: node src/materials/billOfQuantities.check.mjs
import assert from 'node:assert/strict';
import { billOfQuantities, priceSnapshot } from './billOfQuantities.js';

const library = [
    { id: 'oak', name: 'Oak', price: 50, vatRate: 22, waste: 10 },   // current price list
    { id: 'paint', name: 'Paint' }                                   // no price yet
];
const bill = billOfQuantities({
    plainId: 'plain',
    surfaces: { floor: 'oak', 'wall-left:inner': 'paint', 'wall-right:inner': 'paint', 'wall-back:inner': 'plain' },
    areas: { floor: 24, 'wall-left:inner': 10.8, 'wall-right:inner': 10.8, 'wall-back:inner': 16.2 },
    snapshots: { oak: { name: 'Oak', price: 40, vatRate: 22, waste: 10 } }, // frozen when applied: 40, not 50
    library
});
assert.equal(bill.rows.length, 2, 'plain is not billed');
const oak = bill.rows.find((row) => row.materialId === 'oak');
assert.equal(oak.frozen, true);
assert.equal(oak.quantity, 26.4);                  // 24 m² + 10% waste
assert.deepEqual([oak.net, oak.vat, oak.total], [1056, 232.32, 1288.32]); // 26.4 × 40 € + 22%
const paint = bill.rows.find((row) => row.materialId === 'paint');
assert.equal(paint.area, 21.6);
assert.equal(paint.net, null);
assert.equal(bill.unpriced, 1);
assert.deepEqual(bill.totals, { net: 1056, vat: 232.32, total: 1288.32 });
// deleted material without snapshot still shows its faces
assert.equal(billOfQuantities({ plainId: 'plain', surfaces: { floor: 'gone' }, areas: { floor: 1 }, snapshots: {}, library: [] }).rows[0].name, 'Deleted material');
assert.equal(priceSnapshot({ name: 'Paint' }), null);
assert.deepEqual(priceSnapshot(library[0]), { name: 'Oak', code: null, url: null, price: 50, vatRate: 22, waste: 10 });
console.log('billOfQuantities: ok');
