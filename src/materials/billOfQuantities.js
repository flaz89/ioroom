import { DEFAULT_VAT, priceBreakdown } from './pricing.js';

/*
* Bill of quantities ("computo metrico") of the room surfaces: one row per material in use (Plain is never
* billed), with the faces it covers, their area, the quantity to buy (area + waste %) and the price.
*
* Prices are FROZEN per project: `snapshots` (store priceSnapshots, synced in the room) hold the product
* card of each material as it was when first applied in this project, so a later price-list change does
* not alter an estimate. A material without a snapshot (applied before it had a price) uses the current
* library record. Amounts: net (VAT excluded) + VAT, per row and in total.
*
* input: surfaces { faceId: materialId }, areas { faceId: m² } (roomLayout.js surfaceAreas),
*        snapshots { materialId: card }, library [material records], plainId.
* output: { rows: [{ materialId, name, code, url, faces: [{ surfaceId, area }], area, waste, quantity,
*          price, vatRate, frozen, net, vat, total }], totals: { net, vat, total }, unpriced }
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
        const snapshot = snapshots[materialId];
        const card = snapshot ?? library.find((material) => material.id === materialId) ?? { name: 'Deleted material' };
        const area = round2(faces.reduce((sum, face) => sum + face.area, 0));
        const waste = card.waste ?? 0;
        const quantity = round2(area * (1 + waste / 100));
        const vatRate = card.vatRate ?? DEFAULT_VAT;
        const priced = card.price != null;
        const amounts = priced ? priceBreakdown(quantity, card.price, vatRate) : { net: null, vat: null, total: null };
        return {
            materialId, name: card.name, code: card.code ?? null, url: card.url ?? null,
            faces, area, waste, quantity, price: priced ? card.price : null, vatRate, frozen: snapshot != null, ...amounts
        };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const priced = rows.filter((row) => row.net != null);
    const totals = {
        net: round2(priced.reduce((sum, row) => sum + row.net, 0)),
        vat: round2(priced.reduce((sum, row) => sum + row.vat, 0)),
        total: round2(priced.reduce((sum, row) => sum + row.total, 0))
    };
    return { rows, totals, unpriced: rows.length - priced.length };
}

// Product card frozen into a project (only what the bill needs); null when the material has no price yet
export function priceSnapshot(material) {
    if (material?.price == null) return null;
    const { name, code = null, url = null, price, vatRate = null, waste = null } = material;
    return { name, code, url, price, vatRate, waste };
}
