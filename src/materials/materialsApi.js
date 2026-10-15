import { API_ORIGIN, adminToken } from '../sync/roomSync';

/*
* Client of the material library API of the server (server/src/materials.js, Cloudflare R2).
* - listMaterials(): public, every viewer loads it (materials used in a room must render for guests);
* - createMaterial / updateMaterial / deleteMaterial: owner only (admin token kept by roomSync.js).
* Records come back with absolute texture URLs (maps.color / normal / orm), ready for the scene and
* the library (materials/library.js).
* Errors reject with an Error whose message is meant for the UI.
*/
const API = `${API_ORIGIN}/api/materials`;

// Server record (R2 keys) -> library record (URLs served by the Worker, /files/<key>)
const withUrls = (record) => ({
    ...record,
    maps: Object.fromEntries(Object.entries(record.maps).map(([map, key]) => [map, `${API_ORIGIN}/files/${key}`]))
});

async function check(response) {
    if (response.ok) return response;
    const { error } = await response.json().catch(() => ({}));
    throw new Error(error ?? `Request failed (${response.status})`);
}

export async function listMaterials() {
    const response = await check(await fetch(API));
    return (await response.json()).map(withUrls);
}

// fields: { name, category, kind, tileSize }, files: { color, normal?, orm? } (Blob)
export async function createMaterial(fields, files) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) if (value != null) form.append(key, String(value));
    for (const [map, blob] of Object.entries(files)) if (blob) form.append(map, blob, `${map}.${blob.type.split('/')[1]}`);
    const response = await check(await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: form }));
    return withUrls(await response.json());
}

// Edits the fields of a material (never its maps): { name?, category?, kind?, tileSize? }
export async function updateMaterial(id, fields) {
    const response = await check(await fetch(`${API}/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
    }));
    return withUrls(await response.json());
}

export async function deleteMaterial(id) {
    await check(await fetch(`${API}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } }));
}
