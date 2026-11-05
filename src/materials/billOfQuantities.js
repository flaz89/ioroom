import { DEFAULT_VAT, priceBreakdown } from './pricing.js';
import { variantOf, variantPriceKey } from '../models/variants.js';

/*
* Bill of quantities ("computo metrico") of the room surfaces: one row per material in use (Plain is never
* billed), with the faces it covers, their area, the quantity to buy (area + waste %) and the price.
*
* Prices FOLLOW the library: a price-list change updates every estimate (Flavio, 05/11). `snapshots` (store
* priceSnapshots, synced in the room: the product card when first applied) are only the fallback of a
* material deleted from the library. Amounts: net (VAT excluded) + VAT, per row and in total.
*
* input: surfaces { faceId: materialId }, areas { faceId: m² } (roomLayout.js surfaceAreas),
*        snapshots { materialId: card }, library [material records], plainId.
* output: { rows: [{ materialId, name, code, url, faces: [{ surfaceId, area }], area, waste, quantity,
*          price, vatRate, net, vat, total }], totals: { net, vat, total }, unpriced }
*          (price / net / vat / total null when the material has no price; unpriced = their count).
*/
const round2 = (value) => Math.round(value * 100) / 100;

export function billOfQuantities({ surfaces, areas, snapshots, library, plainId }) {
    const byMaterial = new Map();
    for (const [surfaceId, materialId] of Object.entries(surfaces)) {
        if (materialId == null || materialId === plainId || areas[surfaceId] == null) continue;
        if (!byMaterial.has(materialId)) byMaterial.set(materialId, []);
        byMaterial.get(materialId).push({ surfaceId, area: areas[surfaceId] });
    }
    const rows = [...byMaterial.entries()].map(([materialId, faces]) => {
        const card = library.find((material) => material.id === materialId) ?? snapshots[materialId] ?? { name: 'Deleted material' };
        const area = round2(faces.reduce((sum, face) => sum + face.area, 0));
        const waste = card.waste ?? 0;
        const quantity = round2(area * (1 + waste / 100));
        const vatRate = card.vatRate ?? DEFAULT_VAT;
        const priced = card.price != null;
        const amounts = priced ? priceBreakdown(quantity, card.price, vatRate) : { net: null, vat: null, total: null };
        return {
            materialId, name: card.name, code: card.code ?? null, url: card.url ?? null,
            faces, area, waste, quantity, price: priced ? card.price : null, vatRate, ...amounts
        };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { rows, totals: sumTotals(rows), unpriced: rows.filter((row) => row.net == null).length };
}

/*
* Furniture rows of the bill (plan U9): one row per catalog model + variant in the scene (primitives are never
* billed), with the number of pieces. Price per piece: the current catalog; a model deleted from the catalog
* falls back to its snapshot (`model:<id>:<variant>`, models/variants.js), or shows up without a price.
* input: instances (store objects.instances), snapshots, models (store libraryModels).
* output: { rows: [{ key, name, brand, variant, code, url, quantity, price, vatRate, net, vat, total }],
*          totals: { net, vat, total }, unpriced } (same shape as billOfQuantities).
*/
export function furnitureBill({ instances, snapshots, models }) {
    const counts = new Map();
    for (const object of instances) {
        if (object.type !== 'model') continue;
        const key = variantPriceKey(object.modelId, object.variantId);
        counts.set(key, { object, quantity: (counts.get(key)?.quantity ?? 0) + 1 });
    }
    const rows = [...counts.entries()].map(([key, { object, quantity }]) => {
        const model = models.find((item) => item.id === object.modelId);
        const variant = model ? variantOf(model, object.variantId) : null;
        const card = model
            ? { name: model.name, brand: model.brand, variant: variant?.name, code: variant?.code, url: model.url, price: variant?.price, vatRate: variant?.vatRate }
            : snapshots[key] ?? { name: 'Deleted furniture' };
        const vatRate = card.vatRate ?? DEFAULT_VAT;
        const priced = card.price != null;
        const amounts = priced ? priceBreakdown(quantity, card.price, vatRate) : { net: null, vat: null, total: null };
        return {
            key, name: card.name, brand: card.brand ?? null, variant: card.variant ?? null, code: card.code || null, url: card.url || null,
            quantity, price: priced ? card.price : null, vatRate, ...amounts
        };
    }).sort((a, b) => a.name.localeCompare(b.name) || (a.variant ?? '').localeCompare(b.variant ?? ''));
    return { rows, totals: sumTotals(rows), unpriced: rows.filter((row) => row.net == null).length };
}

// { net, vat, total } of priced rows (or of other totals), rounded to cents
export function sumTotals(items) {
    const sum = (key) => round2(items.reduce((total, item) => total + (item[key] ?? 0), 0));
    return { net: sum('net'), vat: sum('vat'), total: sum('total') };
}
