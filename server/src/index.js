import { routePartykitRequest } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';

/*
* ioroom shared room = one saved environment (level).
* Each room is a Durable Object holding a Yjs document; every client of the room (PC, tablet, phone,
* headset) syncs the same document over a WebSocket (client side: src/sync/roomSync.js).
* The document is persisted in the Durable Object's own storage, so a room survives when everyone leaves.
* URL: wss://<worker host>/parties/room-server/<room id>
*/
const STORAGE_KEY = 'document';

export class RoomServer extends YServer {
    // onSave cadence: after edits settle (debounce), at most every 10 s while editing, and when the room empties
    static callbackOptions = { debounceWait: 2000, debounceMaxWait: 10000, timeout: 5000 };

    // Called once when the first client connects: restore the saved document, if any
    async onLoad() {
        const saved = await this.ctx.storage.get(STORAGE_KEY);
        if (saved != null) Y.applyUpdate(this.document, new Uint8Array(saved));
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
