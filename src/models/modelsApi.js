import { API_ORIGIN, adminToken } from '../sync/roomSync';

/*
* Client of the furniture catalog API of the server (server/src/models.js, Cloudflare R2).
* - listModels(): public, every viewer loads it (furniture placed in a room must render for guests);
* - createModel / updateModel / uploadModelTextures / deleteModel: owner only (admin token kept by
*   roomSync.js), used by the upload modal (ui/catalog-menu/ModelCreateModal.jsx).
* Records keep the R2 keys of their files (files.glb / files.thumb, variant overrides[material].map): the
* owner's edits send them back unchanged; modelFileUrl(key) gives the URL to load.
* Errors reject with an Error whose message is meant for the UI.
*/
const API = `${API_ORIGIN}/api/models`;

export const modelFileUrl = (key) => `${API_ORIGIN}/files/${key}`;

async function check(response) {
    if (response.ok) return response;
    const { error } = await response.json().catch(() => ({}));
    throw new Error(error ?? `Request failed (${response.status})`);
}

const auth = () => ({ Authorization: `Bearer ${adminToken}` });

export async function listModels() {
    return (await check(await fetch(API))).json();
}

// fields: { name, brand, category, subtype, size, fixed, url, variants }; glb, thumb: Blobs
export async function createModel(fields, glb, thumb) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
        if (value != null) form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    form.append('glb', glb, 'model.glb');
    form.append('thumb', thumb, `thumb.${thumb.type.split('/')[1]}`);
    return (await check(await fetch(API, { method: 'POST', headers: auth(), body: form }))).json();
}

// Edits the fields (any subset; `variants` replaces the list and deletes the textures it no longer uses)
export async function updateModel(id, fields) {
    const response = await fetch(`${API}/${id}`, {
        method: 'PATCH',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
    });
    return (await check(response)).json();
}

// Variant textures (Blobs) -> their R2 keys, in the same order; reference them in a PATCH of the variants
export async function uploadModelTextures(id, blobs) {
    const form = new FormData();
    for (const blob of blobs) form.append('file', blob, `texture.${blob.type.split('/')[1]}`);
    return (await (await check(await fetch(`${API}/${id}/textures`, { method: 'POST', headers: auth(), body: form }))).json()).keys;
}

export async function deleteModel(id) {
    await check(await fetch(`${API}/${id}`, { method: 'DELETE', headers: auth() }));
}
