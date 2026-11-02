/*
* Uploads the test furniture (Poly Haven CC0 models) to the furniture catalog in R2 (server/src/models.js).
* GLBs: test/models/out/<id>.glb, already prepared (one mesh, Draco, WebP: see "Catalogo mobili" in
* AGENTS.md). Thumbnails: Poly Haven's own render (the app will render its own with the upload modal, plan U5).
*
* Run from the project root with the owner's token:
*   ADMIN_TOKEN=... node scripts/seed-models.mjs
* Sync host: env SYNC_HOST, else VITE_SYNC_HOST from .env.local. Models with the same name already in the
* catalog are skipped (ids are random), so it can be run again after a failure.
*/
import { readFile } from 'node:fs/promises';

const MODELS = [
    {
        id: 'modern_arm_chair_01', name: 'Modern armchair', category: 'seating', subtype: 'armchair', size: [0.82, 1.02, 0.99],
        variants: [
            { name: 'Black leather', code: 'PH-AC01-BLK', price: 450, vatRate: 22 },
            { name: 'Blue leather', code: 'PH-AC01-BLU', price: 480, vatRate: 22, overrides: { modern_arm_chair_01_pillow: { tint: '#4a6cd4' } } }
        ]
    },
    {
        id: 'sofa_03', name: 'Sofa', category: 'seating', subtype: 'sofa', size: [2.73, 1.12, 0.93],
        variants: [{ name: 'Original', code: 'PH-SF03', price: 1200, vatRate: 22 }]
    },
    {
        id: 'modern_wooden_cabinet', name: 'Slatted sideboard', category: 'storage', subtype: 'sideboard', size: [2.44, 0.68, 0.52],
        variants: [{ name: 'Walnut', code: 'PH-SB01', price: 900, vatRate: 22 }]
    }
];

const token = process.env.ADMIN_TOKEN;
if (!token) throw new Error('Set ADMIN_TOKEN');
const envHost = (await readFile('.env.local', 'utf8').catch(() => '')).match(/^VITE_SYNC_HOST=(.+)$/m)?.[1]?.trim();
const host = process.env.SYNC_HOST ?? envHost;
if (!host) throw new Error('Set SYNC_HOST (or VITE_SYNC_HOST in .env.local)');
const api = `${/^(localhost|127\.)/.test(host) ? 'http' : 'https'}://${host}/api/models`;
const auth = { Authorization: `Bearer ${token}` };

const existing = new Set((await (await fetch(api)).json()).map((model) => model.name));
for (const { id, ...model } of MODELS) {
    if (existing.has(model.name)) { console.log(`= ${model.name} (already in the catalog)`); continue; }
    const thumb = await fetch(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`);
    if (!thumb.ok) throw new Error(`${id}: thumbnail ${thumb.status}`);
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...model, brand: 'Poly Haven', fixed: false, url: `https://polyhaven.com/a/${id}` })) {
        form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    form.append('glb', new Blob([await readFile(`test/models/out/${id}.glb`)], { type: 'model/gltf-binary' }), 'model.glb');
    form.append('thumb', new Blob([await thumb.arrayBuffer()], { type: 'image/png' }), 'thumb.png');
    const response = await fetch(api, { method: 'POST', headers: auth, body: form });
    if (!response.ok) throw new Error(`${model.name}: ${response.status} ${await response.text()}`);
    console.log(`+ ${model.name}`);
}
console.log('Done');
