/*
* Uploads the starter materials (Poly Haven CC0 sets) to the material library in R2
* (server/src/materials.js), keeping their ids so rooms that already use them keep working.
* Files: scripts/.textures/<id>/<id>_{diff,nor_gl,arm}_1k.webp (download: scripts/fetch-textures.sh,
* then WebP conversion). ARM = R ambient occlusion, G roughness, B metalness: uploaded as the ORM map.
*
* Run from the project root with the owner's token:
*   ADMIN_TOKEN=... node scripts/seed-materials.mjs              (adds the missing ones)
*   ADMIN_TOKEN=... node scripts/seed-materials.mjs --replace wall   (re-uploads a category, same ids)
* Sync host: env SYNC_HOST, else VITE_SYNC_HOST from .env.local. Materials already in the library are
* skipped (the server answers 409), so it can be run again after a failure. --replace <category> first
* deletes that category's materials, then uploads them again (rooms keep using them: same ids).
*/
import { readFile } from 'node:fs/promises';

const MATERIALS = [
    { id: 'diagonal_parquet', name: 'Diagonal parquet', category: 'floor', tileSize: 2.36 },
    { id: 'dark_wooden_planks', name: 'Dark planks', category: 'floor', tileSize: 2 },
    { id: 'concrete_floor_painted', name: 'Painted concrete', category: 'floor', tileSize: 2 },
    { id: 'beige_wall_001', name: 'Beige plaster', category: 'wall', tileSize: 3 },
    { id: 'clay_plaster', name: 'Clay plaster', category: 'wall', tileSize: 2 },
    // Poly Haven says 3 m, but its bricks read too big next to real ones: calibrated by eye
    { id: 'brick_wall_001', name: 'Brick', category: 'wall', tileSize: 1.5 }
];
const FILES = { color: 'diff', normal: 'nor_gl', orm: 'arm' }; // upload field -> file suffix

const token = process.env.ADMIN_TOKEN;
if (!token) throw new Error('Set ADMIN_TOKEN');
const envHost = (await readFile('.env.local', 'utf8').catch(() => '')).match(/^VITE_SYNC_HOST=(.+)$/m)?.[1]?.trim();
const host = process.env.SYNC_HOST ?? envHost;
if (!host) throw new Error('Set SYNC_HOST (or VITE_SYNC_HOST in .env.local)');
const api = `${/^(localhost|127\.)/.test(host) ? 'http' : 'https'}://${host}/api/materials`;

const replaceIndex = process.argv.indexOf('--replace');
const replaceCategory = replaceIndex >= 0 ? process.argv[replaceIndex + 1] : null;
const auth = { Authorization: `Bearer ${token}` };

for (const material of MATERIALS) {
    if (material.category === replaceCategory) {
        const removed = await fetch(`${api}/${material.id}`, { method: 'DELETE', headers: auth });
        if (removed.ok) console.log(`- ${material.id} (replacing)`);
    }
    const form = new FormData();
    for (const [key, value] of Object.entries(material)) form.append(key, String(value));
    for (const [field, suffix] of Object.entries(FILES)) {
        const path = `scripts/.textures/${material.id}/${material.id}_${suffix}_1k.webp`;
        form.append(field, new Blob([await readFile(path)], { type: 'image/webp' }), `${field}.webp`);
    }
    const response = await fetch(api, { method: 'POST', headers: auth, body: form });
    if (response.status === 409) console.log(`= ${material.id} (already in the library)`);
    else if (response.ok) console.log(`+ ${material.id}`);
    else throw new Error(`${material.id}: ${response.status} ${await response.text()}`);
}
console.log('Done');
