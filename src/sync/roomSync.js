import { useSyncExternalStore } from 'react';
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
*
* ACCESS (development phase): only the owner creates rooms. The owner's devices hold the admin token
* (opened once with ?admin=<token>, then kept in localStorage), used by the "My environments" API of the
* server (server/src/index.js) to create, rename, duplicate and delete rooms. Joining a room needs only its
* link: without ?room the app stays in local mode, and a room that does not exist reports "not-found".
*/

// Worker host without protocol, e.g. "ioroom-sync.<account>.workers.dev" (localhost:8787 = wrangler dev).
// Unset = no sync: the app works locally as before.
export const SYNC_HOST = import.meta.env.VITE_SYNC_HOST;
const PARTY = 'room-server'; // kebab-case of the RoomServer Durable Object binding (server/wrangler.jsonc)
const LOCAL = Symbol('local'); // transaction origin of this device's own edits
const ROOM_NOT_FOUND = 4004;   // close code of the server for rooms that do not exist (and cannot be created)
const ADMIN_TOKEN_KEY = 'ioroom.adminToken';

// Owner token: taken from ?admin=… (then removed from the URL and remembered), else from localStorage
function readAdminToken() {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('admin');
    try {
        if (fromUrl) {
            localStorage.setItem(ADMIN_TOKEN_KEY, fromUrl);
            url.searchParams.delete('admin');
            window.history.replaceState(null, '', url);
            return fromUrl;
        }
        return localStorage.getItem(ADMIN_TOKEN_KEY);
    } catch {
        return fromUrl; // storage blocked: works for this visit only
    }
}
export const adminToken = readAdminToken();

// Whether this device belongs to the owner (can create rooms and share them)
export const isAdmin = adminToken != null && adminToken !== '';

// ROOM STATUS (React: useRoomStatus): 'local' (no room) | 'connecting' | 'connected' | 'not-found'
let roomStatus = 'local';
const statusListeners = new Set();
function setRoomStatus(status) {
    roomStatus = status;
    statusListeners.forEach((listener) => listener());
}
export function useRoomStatus() {
    return useSyncExternalStore(
        (listener) => { statusListeners.add(listener); return () => statusListeners.delete(listener); },
        () => roomStatus
    );
}

// Room id from ?room=…, null when missing (local mode)
export function getRoomId() {
    return new URL(window.location.href).searchParams.get('room');
}

// Connects this device to `room`; returns the disconnect function
export function connectRoom(room) {
    const doc = new Y.Doc();
    const yObjects = doc.getMap('objects');
    const provider = new YProvider(SYNC_HOST, room, doc, { party: PARTY });

    // Status for the UI; a room that does not exist stops the reconnection attempts
    setRoomStatus('connecting');
    provider.on('status', ({ status }) => {
        if (status === 'connected') setRoomStatus('connected');
    });
    provider.on('connection-close', (event) => {
        if (event?.code !== ROOM_NOT_FOUND) return;
        provider.disconnect();
        setRoomStatus('not-found');
    });
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
        setRoomStatus('local');
        unbindAwareness();
        yObjects.unobserve(pull);
        unsubscribe();
        provider.destroy();
        doc.destroy();
    };
}
