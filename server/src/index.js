import { DurableObject } from 'cloudflare:workers';
import { getServerByName, routePartykitRequest } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';

/*
* ioroom shared room = one saved environment (level).
* Each room is a Durable Object holding a Yjs document; every client of the room (PC, tablet, phone,
* headset) syncs the same document over a WebSocket (client side: src/sync/roomSync.js).
* The document is persisted in the Durable Object's own storage, so a room survives when everyone leaves.
* URL: wss://<worker host>/parties/room-server/<room id>
*
* ACCESS (development phase): only the owner manages rooms, through the REST API below authenticated with
* `Authorization: Bearer <ADMIN_TOKEN>` (Worker secret: `npx wrangler secret put ADMIN_TOKEN`).
* Existing rooms are open over WebSocket to whoever has the link; a room that does not exist (never created,
* or deleted) closes the socket with code 4004 ("room not found").
*
* "MY ENVIRONMENTS" API (owner only):
*   GET    /api/rooms                 -> [{ id, name, createdAt, updatedAt }] most recently edited first
*   POST   /api/rooms                 { name? } -> new empty room
*   PATCH  /api/rooms/:id             { name } -> rename
*   POST   /api/rooms/:id/duplicate   { name? } -> new room with a copy of the scene
*   DELETE /api/rooms/:id             -> deletes the room and its saved scene (connected clients get 4004)
* The list lives in the RoomRegistry Durable Object (rooms cannot be enumerated otherwise).
*/
const STORAGE_KEY = 'document';
const CREATED_KEY = 'created';     // set when the owner creates the room
const ROOM_NOT_FOUND = 4004;       // WebSocket close code read by the client (src/sync/roomSync.js)
const DEFAULT_NAME = 'Untitled environment';
const MAX_NAME_LENGTH = 80;
// ponytail: a single registry for the single owner; one registry per user id when accounts arrive
const OWNER_REGISTRY = 'owner';

// Connections refused by onConnect: their messages are ignored until the socket is closed
const refused = new WeakSet();

export class Room extends YServer {
    // onSave cadence: after edits settle (debounce), at most every 10 s while editing, and when the room empties
    static callbackOptions = { debounceWait: 2000, debounceMaxWait: 10000, timeout: 5000 };

    // Called once when the first client connects: restore the saved document, if any
    async onLoad() {
        const saved = await this.ctx.storage.get(STORAGE_KEY);
        if (saved != null) Y.applyUpdate(this.document, new Uint8Array(saved));
    }

    // A room exists once created by the owner (or, for rooms made before access control, once saved)
    async roomExists() {
        return (await this.ctx.storage.get(CREATED_KEY)) === true || (await this.ctx.storage.get(STORAGE_KEY)) != null;
    }

    // Existing rooms accept everyone with the link; rooms are created only through the API (create())
    async onConnect(connection, context) {
        if (this.deleted || !(await this.roomExists())) {
            refused.add(connection);
            connection.close(ROOM_NOT_FOUND, 'Room not found');
            return;
        }
        return super.onConnect(connection, context);
    }

    onMessage(connection, message) {
        if (refused.has(connection)) return;
        return super.onMessage(connection, message);
    }

    // Save the whole document as a single Yjs update.
    // ponytail: one storage value per room (fine for scenes of primitives, ~2 MB value limit);
    // split into chunks or keep incremental updates if environments grow (e.g. embedded models).
    // Also refreshes the room's "last edited" time in the registry (and registers rooms made before it).
    async onSave() {
        if (this.deleted) return; // a pending save must not bring a deleted room back
        await this.ctx.storage.put(STORAGE_KEY, Y.encodeStateAsUpdate(this.document));
        await registry(this.env).upsert(this.name, {});
    }

    // RPC (API only, via getServerByName so the document is already loaded):

    // Marks the room as existing, optionally starting from a scene copied from another room
    async create(state) {
        await this.ctx.storage.put(CREATED_KEY, true);
        if (state) Y.applyUpdate(this.document, state);
        await this.onSave();
    }

    // Current scene as a single Yjs update (used to duplicate the room)
    exportState() {
        return Y.encodeStateAsUpdate(this.document);
    }

    // Deletes the saved scene and disconnects everyone. The flag covers this instance's lifetime
    // (in-memory document, pending saves); once evicted, the empty storage means "not found".
    async destroy() {
        this.deleted = true;
        for (const connection of this.getConnections()) connection.close(ROOM_NOT_FOUND, 'Room deleted');
        await this.ctx.storage.deleteAll();
    }
}

/*
* List of the owner's rooms: one storage entry per room, key "room:<id>",
* value { id, name, createdAt, updatedAt } (ms timestamps).
*/
export class RoomRegistry extends DurableObject {
    async list() {
        const rooms = [...(await this.ctx.storage.list({ prefix: 'room:' })).values()];
        return rooms.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    get(id) {
        return this.ctx.storage.get(`room:${id}`);
    }

    // Creates the entry if missing, merges `fields` (e.g. name) and refreshes updatedAt
    async upsert(id, fields) {
        const now = Date.now();
        const room = { id, name: DEFAULT_NAME, createdAt: now, ...(await this.get(id)), ...fields, updatedAt: now };
        await this.ctx.storage.put(`room:${id}`, room);
        return room;
    }

    remove(id) {
        return this.ctx.storage.delete(`room:${id}`);
    }
}

const registry = (env) => env.RoomRegistry.get(env.RoomRegistry.idFromName(OWNER_REGISTRY));
const room = (env, id) => getServerByName(env.RoomServer, id);

// CORS: the app runs on another origin (Vercel, localhost). Bearer token, no cookies, so "*" is fine.
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400'
};
const json = (body, status = 200) => Response.json(body, { status, headers: CORS });
const error = (message, status) => json({ error: message }, status);

// Name from the request body: trimmed and capped; `fallback` when missing or blank
async function readName(request, fallback) {
    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LENGTH) : '';
    return name || fallback;
}

// Handles /api/rooms[/:id[/duplicate]]; null for any other path
async function handleApi(request, env) {
    const match = new URL(request.url).pathname.match(/^\/api\/rooms(?:\/([\w-]+))?(\/duplicate)?\/?$/);
    if (!match) return null;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
    if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return error('Unauthorized', 401);

    const [, id, duplicate] = match;
    const rooms = registry(env);
    const method = request.method;

    if (!id) {
        if (method === 'GET') return json(await rooms.list());
        if (method === 'POST') {
            const newId = crypto.randomUUID();
            const entry = await rooms.upsert(newId, { name: await readName(request, DEFAULT_NAME) });
            await (await room(env, newId)).create();
            return json(entry, 201);
        }
        return error('Method not allowed', 405);
    }

    const entry = await rooms.get(id);
    if (!entry) return error('Room not found', 404);

    if (duplicate) {
        if (method !== 'POST') return error('Method not allowed', 405);
        const newId = crypto.randomUUID();
        const state = await (await room(env, id)).exportState();
        const copy = await rooms.upsert(newId, { name: await readName(request, `${entry.name} (copy)`) });
        await (await room(env, newId)).create(state);
        return json(copy, 201);
    }
    if (method === 'PATCH') return json(await rooms.upsert(id, { name: await readName(request, entry.name) }));
    if (method === 'DELETE') {
        await (await room(env, id)).destroy();
        await rooms.remove(id);
        return new Response(null, { status: 204, headers: CORS });
    }
    return error('Method not allowed', 405);
}

export default {
    // /api/rooms -> owner API; /parties/:party/:room -> the matching room; anything else is not served
    async fetch(request, env) {
        return (await handleApi(request, env))
            ?? (await routePartykitRequest(request, env))
            ?? new Response('Not Found', { status: 404 });
    }
};
