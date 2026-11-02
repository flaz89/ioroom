/*
* Furniture catalog API (3D models uploaded by the owner as a sample library), stored in Cloudflare R2
* (same bucket as the material library: binding MATERIALS, prefix "models/<owner>/<id>/"; plan:
* docs/plans/2026-10-27-1007-feat-models-catalog-plan.md, U1).
*
*   GET    /api/models                    -> [record]   public: every viewer must render the models in use
*   POST   /api/models                    multipart: glb (file, Draco GLB, max 30 MB), thumb (file, image
*                                         rendered by the browser), name, brand, category, subtype (shape
*                                         only: the lists live in the client), size (JSON [w, h, d] meters),
*                                         fixed ('true' | 'false'), url (optional), variants (JSON, see below)
*                                         -> record     owner only (Authorization: Bearer <ADMIN_TOKEN>)
*   PATCH  /api/models/:id                JSON { name, brand, category, subtype, size, fixed, url, variants }
*                                         (any subset; variants replaces the whole list and deletes the
*                                         variant textures no variant uses any more) -> record   owner only
*   POST   /api/models/:id/textures       multipart: file (one or more images, max 4 MB each)
*                                         -> { keys }   owner only: variant textures, then referenced by
*                                         `overrides[material].map` with a PATCH
*   DELETE /api/models/:id                -> 204        owner only: removes the record and every file of its prefix
*   GET    /files/models/:owner/:id/:file -> the file (public, immutable, cached for a year)
*
* Record: { id, owner, name, brand, category, subtype, size, fixed, url, files: { glb, thumb } (R2 keys),
* variants: [{ id, name, code, price, vatRate, overrides }], createdAt }.
* A variant changes the GLB's materials by name: overrides = { <material name>: { tint?: '#rrggbb',
* map?: <R2 key of a texture of this model> } }. price = net € per piece (VAT excluded).
* The browser checks the GLB contract (one mesh node, at least one texture) before the upload; the server
* only checks the glTF header, types and sizes.
*
* Upload the textures first, then PATCH the variants that use them: a PATCH of the variants deletes every
* texture of the model they do not reference.
*
* ponytail: same single-writer index as materials.js (models/index.json rewritten on every change).
*/
const INDEX_KEY = 'models/index.json';
const OWNER = 'system'; // the sample library; personal libraries will use the account id
const ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
const SLUG_PATTERN = /^[a-z0-9-]{1,32}$/; // category, subtype
const TINT_PATTERN = /^#[0-9a-f]{6}$/i;
const MAX_GLB_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 60;
const MAX_VARIANTS = 50;
const MAX_OVERRIDES = 32;
const MAX_SIZE = 50; // meters, any side
const IMAGE_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const GLB_TYPE = 'model/gltf-binary';

async function readIndex(env) {
    const object = await env.MATERIALS.get(INDEX_KEY);
    return object ? object.json() : [];
}

const writeIndex = (env, list) => env.MATERIALS.put(INDEX_KEY, JSON.stringify(list), {
    httpMetadata: { contentType: 'application/json' }
});

const prefixOf = (id) => `models/${OWNER}/${id}/`;
const text = (value, max = MAX_TEXT) => (value == null ? '' : String(value).trim().slice(0, max));
const parseJson = (value) => {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return undefined; }
};

// Optional number in [0, max], or null; undefined when invalid
function optionalNumber(value, max) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return number >= 0 && number <= max ? number : undefined;
}

/*
* Validates the variant list of model `id`; returns { variants } or { error }. Variant ids are kept
* (scenes and price snapshots refer to them) or created; texture keys must belong to this model.
*/
function readVariants(raw, id) {
    if (!Array.isArray(raw) || raw.length === 0) return { error: 'At least one variant is required' };
    if (raw.length > MAX_VARIANTS) return { error: `At most ${MAX_VARIANTS} variants` };
    const ids = new Set();
    const variants = [];
    for (const item of raw) {
        if (item == null || typeof item !== 'object') return { error: 'Invalid variant' };
        const variant = { id: item.id ? String(item.id) : crypto.randomUUID().slice(0, 8) };
        if (!ID_PATTERN.test(variant.id) || ids.has(variant.id)) return { error: 'Invalid variant id' };
        ids.add(variant.id);
        variant.name = text(item.name);
        if (!variant.name) return { error: 'Every variant needs a name' };
        variant.code = text(item.code) || null;
        variant.price = optionalNumber(item.price, 1e7);
        variant.vatRate = optionalNumber(item.vatRate, 100);
        if (variant.price === undefined) return { error: `${variant.name}: invalid price` };
        if (variant.vatRate === undefined) return { error: `${variant.name}: invalid VAT rate` };
        const overrides = item.overrides ?? {};
        if (typeof overrides !== 'object' || Object.keys(overrides).length > MAX_OVERRIDES) {
            return { error: `${variant.name}: invalid overrides` };
        }
        variant.overrides = {};
        for (const [material, change] of Object.entries(overrides)) {
            const { tint, map } = change ?? {};
            if (!material || material.length > 100) return { error: `${variant.name}: invalid material name` };
            if (tint != null && !TINT_PATTERN.test(tint)) return { error: `${variant.name}: invalid tint` };
            if (map != null && !(typeof map === 'string' && map.startsWith(prefixOf(id)) && /^[\w/.-]+$/.test(map))) {
                return { error: `${variant.name}: unknown texture` };
            }
            if (tint == null && map == null) continue;
            variant.overrides[material] = { ...(tint != null && { tint: tint.toLowerCase() }), ...(map != null && { map }) };
        }
        variants.push(variant);
    }
    return { variants };
}

/*
* Validates the editable fields of model `id` (raw values from a form or JSON); returns { fields } or
* { error }. `partial`: only the given keys are checked and returned (PATCH).
*/
function readFields(raw, id, partial = false) {
    const fields = {};
    const has = (key) => !partial || raw[key] !== undefined;
    for (const key of ['name', 'brand']) {
        if (!has(key)) continue;
        fields[key] = text(raw[key]);
        if (!fields[key]) return { error: key === 'name' ? 'Name is required' : 'Manufacturer is required' };
    }
    for (const key of ['category', 'subtype']) {
        if (!has(key)) continue;
        fields[key] = text(raw[key]);
        if (!SLUG_PATTERN.test(fields[key])) return { error: `Invalid ${key}` };
    }
    if (has('size')) {
        const size = parseJson(raw.size);
        if (!Array.isArray(size) || size.length !== 3 || !size.every((side) => side > 0 && side <= MAX_SIZE)) {
            return { error: 'Invalid size' };
        }
        fields.size = size.map(Number);
    }
    if (has('fixed')) fields.fixed = raw.fixed === true || raw.fixed === 'true';
    if (has('url')) {
        fields.url = text(raw.url, 500) || null;
        if (fields.url != null && !/^https?:\/\/\S+$/i.test(fields.url)) return { error: 'The link must start with http:// or https://' };
    }
    if (has('variants')) {
        const { variants, error } = readVariants(parseJson(raw.variants), id);
        if (error) return { error };
        fields.variants = variants;
    }
    return { fields };
}

// Image file from a form entry: the file, or { error }
function readImage(file, label) {
    if (file == null || typeof file === 'string' || file.size === 0) return { error: `${label}: file missing` };
    if (!IMAGE_TYPES[file.type]) return { error: `${label}: unsupported image type` };
    if (file.size > MAX_IMAGE_BYTES) return { error: `${label}: file too large (max 4 MB)` };
    return { file };
}

// R2 keys of the model's files, `prefix` included (at most 1000 per page)
async function* keysUnder(env, prefix) {
    let cursor;
    do {
        const page = await env.MATERIALS.list({ prefix, cursor });
        yield page.objects.map((object) => object.key);
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
}

/*
* Deletes the variant textures of `record` that no variant uses any more: dropped by this edit, or uploaded
* and never referenced (an edit that failed after the upload). Called after the record is saved.
*/
async function deleteUnusedTextures(env, record) {
    const used = new Set(record.variants.flatMap((variant) => Object.values(variant.overrides).map((change) => change.map)));
    for await (const keys of keysUnder(env, `${prefixOf(record.id)}tex-`)) {
        const unused = keys.filter((key) => !used.has(key));
        if (unused.length) await env.MATERIALS.delete(unused);
    }
}

// Whether `file` is a binary glTF (header magic "glTF")
async function isGlb(file) {
    const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return String.fromCharCode(...magic) === 'glTF';
}

/*
* Handles /api/models[/:id[/textures]] and /files/models/...; null for any other path.
* `cors`: headers added to every response; `isOwner(request)`: admin token check.
*/
export async function handleModels(request, env, { cors, isOwner }) {
    const { pathname } = new URL(request.url);
    const json = (body, status = 200) => Response.json(body, { status, headers: cors });
    const error = (message, status) => json({ error: message }, status);

    // Files: public, immutable (a new upload always gets a new key)
    const file = pathname.match(/^\/files\/(models\/[\w-]+\/[\w-]+\/[\w.-]+)$/);
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

    const match = pathname.match(/^\/api\/models(?:\/([\w-]+)(\/textures)?)?\/?$/);
    if (!match) return null;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const [, id, textures] = match;

    if (!id && request.method === 'GET') return json(await readIndex(env));
    if (!isOwner(request)) return error('Unauthorized', 401);

    if (!id && request.method === 'POST') {
        const form = await request.formData().catch(() => null);
        if (!form) return error('Expected a multipart form', 400);
        const newId = crypto.randomUUID();
        const { fields, error: invalid } = readFields(Object.fromEntries(
            ['name', 'brand', 'category', 'subtype', 'size', 'fixed', 'url', 'variants'].map((key) => [key, form.get(key)])
        ), newId);
        if (invalid) return error(invalid, 400);
        const glb = form.get('glb');
        if (glb == null || typeof glb === 'string' || glb.size === 0) return error('The GLB file is required', 400);
        if (glb.size > MAX_GLB_BYTES) return error('GLB too large (max 30 MB)', 400);
        if (!(await isGlb(glb))) return error('The file is not a GLB (binary glTF)', 400);
        const thumb = readImage(form.get('thumb'), 'Thumbnail');
        if (thumb.error) return error(thumb.error, 400);

        const files = {
            glb: `${prefixOf(newId)}model.glb`,
            thumb: `${prefixOf(newId)}thumb.${IMAGE_TYPES[thumb.file.type]}`
        };
        await env.MATERIALS.put(files.glb, glb.stream(), { httpMetadata: { contentType: GLB_TYPE } });
        await env.MATERIALS.put(files.thumb, thumb.file.stream(), { httpMetadata: { contentType: thumb.file.type } });
        const record = { id: newId, owner: OWNER, ...fields, files, createdAt: Date.now() };
        await writeIndex(env, [...await readIndex(env), record]);
        return json(record, 201);
    }

    if (!id) return error('Method not allowed', 405);
    const list = await readIndex(env);
    const record = list.find((item) => item.id === id);
    if (!record) return error('Model not found', 404);

    if (textures) {
        if (request.method !== 'POST') return error('Method not allowed', 405);
        const form = await request.formData().catch(() => null);
        const images = form?.getAll('file') ?? [];
        if (images.length === 0) return error('No texture file', 400);
        const checked = images.map((image) => readImage(image, 'Texture'));
        const invalid = checked.find((item) => item.error);
        if (invalid) return error(invalid.error, 400);
        const keys = [];
        for (const { file: image } of checked) {
            const key = `${prefixOf(id)}tex-${crypto.randomUUID()}.${IMAGE_TYPES[image.type]}`;
            await env.MATERIALS.put(key, image.stream(), { httpMetadata: { contentType: image.type } });
            keys.push(key);
        }
        return json({ keys }, 201);
    }

    if (request.method === 'PATCH') {
        const body = await request.json().catch(() => null);
        if (body == null || typeof body !== 'object') return error('Expected a JSON body', 400);
        const { fields, error: invalid } = readFields(body, id, true);
        if (invalid) return error(invalid, 400);
        const updated = { ...record, ...fields };
        await writeIndex(env, list.map((item) => (item.id === id ? updated : item)));
        if (fields.variants) await deleteUnusedTextures(env, updated);
        return json(updated);
    }

    if (request.method === 'DELETE') {
        for await (const keys of keysUnder(env, prefixOf(id))) {
            if (keys.length) await env.MATERIALS.delete(keys);
        }
        await writeIndex(env, list.filter((item) => item.id !== id));
        return new Response(null, { status: 204, headers: cors });
    }
    return error('Method not allowed', 405);
}
