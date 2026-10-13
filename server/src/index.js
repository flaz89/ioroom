import { routePartykitRequest } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';

/*
* ioroom shared room = one saved environment (level).
* Each room is a Durable Object holding a Yjs document; every client of the room (PC, tablet, phone,
* headset) syncs the same document over a WebSocket (client side: src/sync/roomSync.js).
* The document is persisted in the Durable Object's own storage, so a room survives when everyone leaves.
* URL: wss://<worker host>/parties/room-server/<room id>
*
* ACCESS (development phase): only the owner creates rooms. A room that does not exist yet can be opened
* only with ?token=<ADMIN_TOKEN> (Worker secret: `npx wrangler secret put ADMIN_TOKEN`); everyone else is
* closed with code 4004 ("room not found"). Existing rooms are open to whoever has the link.
*/
const STORAGE_KEY = 'document';
const CREATED_KEY = 'created';     // set when the owner creates the room
const ROOM_NOT_FOUND = 4004;       // WebSocket close code read by the client (src/sync/roomSync.js)

// Connections refused by onConnect: their messages are ignored until the socket is closed
const refused = new WeakSet();

export class RoomServer extends YServer {
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

    // Refuse to create rooms without the owner token; existing rooms accept everyone
    async onConnect(connection, context) {
        if (!(await this.roomExists())) {
            const token = new URL(context.request.url).searchParams.get('token');
            if (!this.env.ADMIN_TOKEN || token !== this.env.ADMIN_TOKEN) {
                refused.add(connection);
                connection.close(ROOM_NOT_FOUND, 'Room not found');
                return;
            }
            await this.ctx.storage.put(CREATED_KEY, true);
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
    async onSave() {
        await this.ctx.storage.put(STORAGE_KEY, Y.encodeStateAsUpdate(this.document));
    }
}

export default {
    // Routes /parties/:party/:room to the matching Durable Object; anything else is not served
    async fetch(request, env) {
        return (await routePartykitRequest(request, env)) ?? new Response('Not Found', { status: 404 });
    }
};
