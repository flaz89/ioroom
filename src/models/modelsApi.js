import { API_ORIGIN } from '../sync/roomSync';

/*
* Client of the furniture catalog API of the server (server/src/models.js, Cloudflare R2).
* - listModels(): public, every viewer loads it (furniture placed in a room must render for guests).
* Records keep the R2 keys of their files (files.glb / files.thumb, variant overrides[material].map): the
* owner's edits send them back unchanged; modelFileUrl(key) gives the URL to load.
* Errors reject with an Error whose message is meant for the UI.
* ponytail: owner writes (create / update / textures / delete) arrive with the upload modal (plan U5).
*/
const API = `${API_ORIGIN}/api/models`;

export const modelFileUrl = (key) => `${API_ORIGIN}/files/${key}`;

export async function listModels() {
    const response = await fetch(API);
    if (!response.ok) {
        const { error } = await response.json().catch(() => ({}));
        throw new Error(error ?? `Request failed (${response.status})`);
    }
    return response.json();
}
