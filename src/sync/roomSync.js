import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { useStore } from '../store/appStore';
import { bindAwareness } from './presence';

/*
* Shared room sync: keeps the scene objects (store objects.instances) identical on every device that
* opens the same room (PC, tablet, phone, headset). Server: server/src/index.js (Cloudflare Durable Object).
*
* Model: a Y.Map "objects", id -> plain object instance ({ id, type, geometryType, color, position,
* rotation, scale }). Each instance is replaced as a whole (last writer wins per object), which matches
* how the store already updates objects (immutable copies, transform committed on release).
* - local -> room: a store subscription writes the instances whose reference changed, deletes removed ids;
* - room -> local: remote changes replace objects.instances (selection is cleared if its object is gone).
* Selection, grab state and settings stay per device. Live motion during drags and object locks: see presence.js.
*/

// Worker host without protocol, e.g. "ioroom-sync.<account>.workers.dev" (localhost:8787 = wrangler dev).
// Unset = no sync: the app works locally as before.
export const SYNC_HOST = import.meta.env.VITE_SYNC_HOST;
const PARTY = 'room-server'; // kebab-case of the RoomServer Durable Object binding (server/wrangler.jsonc)
const LOCAL = Symbol('local'); // transaction origin of this device's own edits

// Room id from ?room=…; a new random room (written into the URL, so it can be shared) when missing
export function getRoomId() {
    const url = new URL(window.location.href);
    let room = url.searchParams.get('room');
    if (!room) {
        room = crypto.randomUUID();
        url.searchParams.set('room', room);
        window.history.replaceState(null, '', url);
    }
    return room;
}

// Connects this device to `room`; returns the disconnect function
export function connectRoom(room) {
    const doc = new Y.Doc();
    const yObjects = doc.getMap('objects');
    const provider = new YProvider(SYNC_HOST, room, doc, { party: PARTY });
    let applyingRemote = false; // true while remote state is written into the store (no echo back)

    // local -> room: only what changed (instances are immutable, so a new reference = an edit)
    const push = (instances, previous) => {
        const previousRefs = new Set(previous);
        const ids = new Set(instances.map((object) => object.id));
        doc.transact(() => {
            for (const object of instances) if (!previousRefs.has(object)) yObjects.set(object.id, object);
            for (const object of previous) if (!ids.has(object.id)) yObjects.delete(object.id);
        }, LOCAL);
    };

    // Objects already in the scene join the room (new room: they seed it; existing room: they merge in)
    push(useStore.getState().objects.instances, []);

    const unsubscribe = useStore.subscribe((state, previousState) => {
        if (applyingRemote || state.objects.instances === previousState.objects.instances) return;
        push(state.objects.instances, previousState.objects.instances);
    });

    // room -> local
    const pull = (event) => {
        if (event.transaction.origin === LOCAL) return;
        applyingRemote = true;
        useStore.getState().setInstances(Array.from(yObjects.values()));
        applyingRemote = false;
    };
    yObjects.observe(pull);

    const unbindAwareness = bindAwareness(provider.awareness);

    return () => {
        unbindAwareness();
        yObjects.unobserve(pull);
        unsubscribe();
        provider.destroy();
        doc.destroy();
    };
}
