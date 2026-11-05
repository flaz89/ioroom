// Check for billOfQuantities.js: node src/materials/billOfQuantities.check.mjs
import assert from 'node:assert/strict';
import { billOfQuantities, furnitureBill, sumTotals } from './billOfQuantities.js';
import { priceSnapshot } from './pricing.js';

const library = [
    { id: 'oak', name: 'Oak', price: 50, vatRate: 22, waste: 10 },   // current price list
    { id: 'paint', name: 'Paint' }                                   // no price yet
];
const bill = billOfQuantities({
    plainId: 'plain',
    surfaces: { floor: 'oak', 'wall-left:inner': 'paint', 'wall-right:inner': 'paint', 'wall-back:inner': 'plain' },
    areas: { floor: 24, 'wall-left:inner': 10.8, 'wall-right:inner': 10.8, 'wall-back:inner': 16.2 },
    snapshots: { oak: { name: 'Oak', price: 40, vatRate: 22, waste: 10 } }, // old snapshot: the library (50) wins
    library
});
assert.equal(bill.rows.length, 2, 'plain is not billed');
const oak = bill.rows.find((row) => row.materialId === 'oak');
assert.equal(oak.quantity, 26.4);                  // 24 m² + 10% waste
assert.deepEqual([oak.net, oak.vat, oak.total], [1320, 290.4, 1610.4]); // 26.4 × 50 € + 22%
const paint = bill.rows.find((row) => row.materialId === 'paint');
assert.equal(paint.area, 21.6);
assert.equal(paint.net, null);
assert.equal(bill.unpriced, 1);
assert.deepEqual(bill.totals, { net: 1320, vat: 290.4, total: 1610.4 });
// deleted material without snapshot still shows its faces
assert.equal(billOfQuantities({ plainId: 'plain', surfaces: { floor: 'gone' }, areas: { floor: 1 }, snapshots: {}, library: [] }).rows[0].name, 'Deleted material');
// deleted material with a snapshot keeps its price
assert.equal(billOfQuantities({ plainId: 'plain', surfaces: { floor: 'gone' }, areas: { floor: 1 }, snapshots: { gone: { name: 'Old', price: 10 } }, library: [] }).rows[0].net, 10);
assert.equal(priceSnapshot({ name: 'Paint' }), null);
assert.deepEqual(priceSnapshot(library[0]), { name: 'Oak', code: null, url: null, price: 50, vatRate: 22, waste: 10 });

// FURNITURE (AE3): two oak chairs and one walnut = two rows (2 and 1); the catalog price (130 €) wins over the
// old snapshot (120 €); primitives are never billed
const models = [
    { id: 'chair', name: 'Chair', brand: 'Acme', url: 'https://acme.example/chair', variants: [{ id: 'oak', name: 'Oak', code: 'C-OAK', price: 130, vatRate: 22 }, { id: 'walnut', name: 'Walnut', price: 150, vatRate: 22 }] },
    { id: 'lamp', name: 'Lamp', brand: 'Acme', variants: [{ id: 'std', name: 'Standard' }] } // no price
];
const piece = (modelId, variantId) => ({ type: 'model', modelId, variantId });
const furniture = furnitureBill({
    instances: [piece('chair', 'oak'), piece('chair', 'walnut'), piece('chair', 'oak'), { type: 'box' }, piece('lamp', 'std'), piece('gone', 'x')],
    snapshots: { 'model:chair:oak': { name: 'Chair', brand: 'Acme', variant: 'Oak', code: 'C-OAK', price: 120, vatRate: 22 } },
    models
});
const [oakRow, walnutRow] = furniture.rows.filter((row) => row.name === 'Chair');
assert.deepEqual([oakRow.variant, oakRow.quantity, oakRow.price], ['Oak', 2, 130]);
assert.deepEqual([oakRow.net, oakRow.vat, oakRow.total], [260, 57.2, 317.2]);
assert.deepEqual([walnutRow.variant, walnutRow.quantity, walnutRow.net], ['Walnut', 1, 150]);
assert.equal(furniture.rows.length, 4, 'box not billed');
assert.equal(furniture.rows.find((row) => row.name === 'Lamp').net, null);
assert.equal(furniture.rows.find((row) => row.name === 'Deleted furniture').net, null);
assert.equal(furniture.unpriced, 2);
assert.deepEqual(furniture.totals, { net: 410, vat: 90.2, total: 500.2 });
// grand total = materials + furniture
assert.deepEqual(sumTotals([bill.totals, furniture.totals]), { net: 1730, vat: 380.6, total: 2110.6 });
// deleted model with a snapshot keeps its price
assert.equal(furnitureBill({ instances: [piece('gone', 'x')], snapshots: { 'model:gone:x': { name: 'Old chair', price: 99 } }, models }).rows[0].net, 99);
console.log('billOfQuantities: ok');
