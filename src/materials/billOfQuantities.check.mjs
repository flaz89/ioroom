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

// FURNITURE (AE3): two oak chairs and one walnut = two rows (2 and 1); the oak price frozen at 120 € stays
// even though the catalog now says 130 €; primitives are never billed
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
assert.deepEqual([oakRow.variant, oakRow.quantity, oakRow.price, oakRow.frozen], ['Oak', 2, 120, true]);
assert.deepEqual([oakRow.net, oakRow.vat, oakRow.total], [240, 52.8, 292.8]);
assert.deepEqual([walnutRow.variant, walnutRow.quantity, walnutRow.frozen, walnutRow.net], ['Walnut', 1, false, 150]); // list price
assert.equal(furniture.rows.length, 4, 'box not billed');
assert.equal(furniture.rows.find((row) => row.name === 'Lamp').net, null);
assert.equal(furniture.rows.find((row) => row.name === 'Deleted furniture').net, null);
assert.equal(furniture.unpriced, 2);
assert.deepEqual(furniture.totals, { net: 390, vat: 85.8, total: 475.8 });
// grand total = materials + furniture
assert.deepEqual(sumTotals([bill.totals, furniture.totals]), { net: 1446, vat: 318.12, total: 1764.12 });
console.log('billOfQuantities: ok');
