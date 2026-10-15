/*
* Material library API (custom materials uploaded by the owner), stored in Cloudflare R2
* (binding MATERIALS, bucket "ioroom-materials", see wrangler.jsonc). Client: src/materials/materialsApi.js.
*
*   GET    /api/materials             -> [record]   public: every viewer must render the materials in use
*   POST   /api/materials             multipart: name, category ('floor' | 'wall'), tileSize (meters),
*                                     color (file, required), normal / orm (files, optional),
*                                     id (optional: keeps a known id, e.g. when migrating materials)
*                                     -> record     owner only (Authorization: Bearer <ADMIN_TOKEN>)
*   DELETE /api/materials/:id         -> 204        owner only: removes the record and its files
*   GET    /files/materials/:id/:file -> the texture file (public, immutable, cached for a year)
*
* Record: { id, name, category, tileSize, maps: { color, normal?, orm? } (R2 keys), createdAt }.
* orm = packed map like glTF: R ambient occlusion, G roughness, B metalness (records uploaded before ORM
* may have `roughness` instead: the client reads both).
* Files are converted to WebP (1K) and packed by the browser before the upload; the server only checks
* type and size.
*
* ponytail: the list is one JSON object (materials/index.json) rewritten on every change: fine for a
* single owner adding materials now and then. Move it to a Durable Object / D1 table when several
* accounts write concurrently.
*/
const INDEX_KEY = 'materials/index.json';
const MAPS = ['color', 'normal', 'orm'];
const ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
const CATEGORIES = ['floor', 'wall'];
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_NAME_LENGTH = 60;
const TILE_SIZE_RANGE = [0.05, 20]; // meters
const FILE_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

async function readIndex(env) {
    const object = await env.MATERIALS.get(INDEX_KEY);
    return object ? object.json() : [];
}

const writeIndex = (env, list) => env.MATERIALS.put(INDEX_KEY, JSON.stringify(list), {
    httpMetadata: { contentType: 'application/json' }
});

// Validates the multipart form; returns { fields, files } or { error }
async function readUpload(request) {
    const form = await request.formData().catch(() => null);
    if (!form) return { error: 'Expected a multipart form' };
    const name = String(form.get('name') ?? '').trim().slice(0, MAX_NAME_LENGTH);
    const category = String(form.get('category') ?? '');
    const tileSize = Number(form.get('tileSize'));
    if (!name) return { error: 'Name is required' };
    if (!CATEGORIES.includes(category)) return { error: 'Unknown category' };
    if (!(tileSize >= TILE_SIZE_RANGE[0] && tileSize <= TILE_SIZE_RANGE[1])) {
        return { error: `Real size must be between ${TILE_SIZE_RANGE[0]} and ${TILE_SIZE_RANGE[1]} m` };
    }
    const files = {};
    for (const map of MAPS) {
        const file = form.get(map);
        if (file == null || typeof file === 'string' || file.size === 0) continue;
        if (!FILE_TYPES[file.type]) return { error: `${map}: unsupported image type` };
        if (file.size > MAX_FILE_BYTES) return { error: `${map}: file too large (max 4 MB)` };
        files[map] = file;
    }
    if (!files.color) return { error: 'The color map is required' };
    const id = form.get('id') ? String(form.get('id')) : null;
    if (id != null && !ID_PATTERN.test(id)) return { error: 'Invalid id' };
    return { id, fields: { name, category, tileSize }, files };
}

/*
* Handles /api/materials[/:id] and /files/materials/...; null for any other path.
* `cors`: headers added to every response; `isOwner(request)`: admin token check.
*/
export async function handleMaterials(request, env, { cors, isOwner }) {
    const { pathname } = new URL(request.url);
    const json = (body, status = 200) => Response.json(body, { status, headers: cors });
    const error = (message, status) => json({ error: message }, status);

    // Texture files: public, immutable (a new upload always gets a new id)
    const file = pathname.match(/^\/files\/(materials\/[\w-]+\/\w+\.\w+)$/);
    if (file) {
        const object = await env.MATERIALS.get(file[1]);
        if (!object) return new Response('Not Found', { status: 404, headers: cors });
        return new Response(object.body, {
            headers: {
                ...cors,
                'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
                'Cache-Control': 'public, max-age=31536000, immutable',
                ETag: object.httpEtag
            }
        });
    }

    const match = pathname.match(/^\/api\/materials(?:\/([\w-]+))?\/?$/);
    if (!match) return null;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const [, id] = match;

    if (!id && request.method === 'GET') return json(await readIndex(env));
    if (!isOwner(request)) return error('Unauthorized', 401);

    if (!id && request.method === 'POST') {
        const upload = await readUpload(request);
        if (upload.error) return error(upload.error, 400);
        const list = await readIndex(env);
        if (upload.id && list.some((item) => item.id === upload.id)) return error('A material with this id already exists', 409);
        const newId = upload.id ?? crypto.randomUUID();
        const maps = {};
        for (const [map, blob] of Object.entries(upload.files)) {
            maps[map] = `materials/${newId}/${map}.${FILE_TYPES[blob.type]}`;
            await env.MATERIALS.put(maps[map], blob.stream(), { httpMetadata: { contentType: blob.type } });
        }
        const record = { id: newId, ...upload.fields, maps, createdAt: Date.now() };
        await writeIndex(env, [...list, record]);
        return json(record, 201);
    }

    if (id && request.method === 'DELETE') {
        const list = await readIndex(env);
        const record = list.find((item) => item.id === id);
        if (!record) return error('Material not found', 404);
        await env.MATERIALS.delete(Object.values(record.maps));
        await writeIndex(env, list.filter((item) => item.id !== id));
        return new Response(null, { status: 204, headers: cors });
    }
    return error('Method not allowed', 405);
}
