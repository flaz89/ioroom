/*
* Floor plan underlays (background drawings traced in the builder), stored in Cloudflare R2 (same bucket as
* the material library: binding MATERIALS, prefix "underlays/"). Client: src/plan/underlayApi.js.
*
*   POST   /api/underlays              multipart: file (webp / jpeg / png, or json: a DXF's vectors; max 8 MB)
*                                      -> { key }   owner only
*   POST   /api/underlays/cleanup      -> { deleted, inUse, recent }   owner only ("Clean storage", My environments):
*                                      deletes the files no registered environment uses, uploaded more than
*                                      CLEANUP_GRACE_MS ago (an underlay replaced or removed in a session that
*                                      is still open can come back with undo)
*   GET    /files/underlays/:id.:ext   -> the file (public, immutable, cached for a year)
*
* The browser prepares the file (PDF page rendered, downscaled, WebP; DXF parsed into line segments, JSON,
* src/plan/dxfUnderlay.js) before the upload: the server only checks type and size. Where the image goes in the plan (scale, position, rotation) is saved with the
* environment (plan level `underlay`, src/plan/planModel.js), not here.
* Files are never deleted when an underlay is replaced or removed (undo / redo can bring it back): unused
* ones are removed by the manual cleanup. `usedKeys()`: every key the environments use (index.js).
*/
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const FILE_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'application/json': 'json' };
const CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000; // files younger than this are never deleted
const PREFIX = 'underlays/';

/*
* Handles /api/underlays[/:id] and /files/underlays/...; null for any other path.
* `cors`: headers added to every response; `isOwner(request)`: admin token check.
*/
export async function handleUnderlays(request, env, { cors, isOwner, usedKeys }) {
    const { pathname } = new URL(request.url);
    const json = (body, status = 200) => Response.json(body, { status, headers: cors });
    const error = (message, status) => json({ error: message }, status);

    // Files: public, immutable (a new upload always gets a new id)
    const file = pathname.match(/^\/files\/(underlays\/[0-9a-f-]{36}\.(?:webp|jpg|png|json))$/);
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

    const isCleanup = /^\/api\/underlays\/cleanup\/?$/.test(pathname);
    if (!isCleanup && !/^\/api\/underlays\/?$/.test(pathname)) return null;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!isOwner(request)) return error('Unauthorized', 401);

    // Storage cleanup: the used keys first (if any room cannot be read, nothing is deleted)
    if (isCleanup) {
        if (request.method !== 'POST') return error('Method not allowed', 405);
        let used;
        try {
            used = new Set(await usedKeys());
        } catch (cause) {
            console.error('underlay cleanup: cannot read the environments', cause);
            return error(`Nothing was deleted: ${cause.message}`, 500);
        }
        const cutoff = Date.now() - CLEANUP_GRACE_MS;
        // inUse: an environment uses it; recent: unused but younger than the grace period (kept for now)
        let deleted = 0, inUse = 0, recent = 0, cursor;
        do {
            const page = await env.MATERIALS.list({ prefix: PREFIX, cursor }); // up to 1000 objects per page
            const unused = [];
            for (const object of page.objects) {
                if (used.has(object.key)) inUse++;
                else if (object.uploaded.getTime() >= cutoff) recent++;
                else unused.push(object.key);
            }
            if (unused.length > 0) await env.MATERIALS.delete(unused);
            deleted += unused.length;
            cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        return json({ deleted, inUse, recent });
    }

    if (request.method === 'POST') {
        const form = await request.formData().catch(() => null);
        const blob = form?.get('file');
        if (blob == null || typeof blob === 'string' || blob.size === 0) return error('The file is required', 400);
        if (!FILE_TYPES[blob.type]) return error('Unsupported file type', 400);
        if (blob.size > MAX_FILE_BYTES) return error('File too large (max 8 MB)', 400);
        const key = `${PREFIX}${crypto.randomUUID()}.${FILE_TYPES[blob.type]}`;
        await env.MATERIALS.put(key, blob.stream(), { httpMetadata: { contentType: blob.type } });
        return json({ key }, 201);
    }
    return error('Method not allowed', 405);
}
