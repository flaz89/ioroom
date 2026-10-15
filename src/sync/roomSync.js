import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { useStore } from '../store/appStore';
import { bindAwareness } from './presence';
import { bindSun } from './sunSync';
import { bindFieldMap } from './fieldMapSync';

/*
* Shared room sync: keeps the scene objects (store objects.instances) identical on every device that
* opens the same room (PC, tablet, phone, headset). Server: server/src/index.js (Cloudflare Durable Object).
*
* Model: a Y.Map "objects", id -> plain object instance ({ id, type, geometryType, color, position,
* rotation, scale }). Each instance is replaced as a whole (last writer wins per object), which matches
* how the store already updates objects (immutable copies, transform committed on release).
* - local -> room: a store subscription writes the instances whose reference changed, deletes removed ids;
* - room -> local: remote changes replace objects.instances (selection is cleared if its object is gone).
* Post-it notes (store notes.items, see store/slices/notesSlice.js): same model, Y.Map "notes" (bindInstances).
* Selection, grab state and settings stay per device. Live motion during drags and object locks: see presence.js.
* Sun settings of the environment (location, north, day, time): see sunSync.js.
* Materials of the room surfaces (store surfaces): Y.Map "surfaces", one key per surface (fieldMapSync.js).
*
* ACCESS (development phase): only the owner creates rooms. The owner's devices hold the admin token
* (opened once with ?admin=<token>, then kept in localStorage), used by the "My environments" API of the
* server (server/src/index.js) to create, rename, duplicate and delete rooms. Joining a room needs only its
* link: without ?room the app stays in local mode, and a room that does not exist reports "not-found".
*/

// Worker host without protocol, e.g. "ioroom-sync.<account>.workers.dev" (localhost:8787 = wrangler dev).
// Unset = no sync: the app works locally as before.
export const SYNC_HOST = import.meta.env.VITE_SYNC_HOST;
// Origin of the server's HTTP API and files (same host as the WebSocket; plain http only for a local
// wrangler dev server). Used by roomsApi.js and materials/materialsApi.js.
export const API_ORIGIN = `${/^(localhost|127\.)/.test(SYNC_HOST ?? '') ? 'http' : 'https'}://${SYNC_HOST}`;
const PARTY = 'rooms'; // kebab-case of the Rooms Durable Object binding (server/wrangler.jsonc)
const LOCAL = Symbol('local'); // transaction origin of this device's own edits
const ROOM_NOT_FOUND = 4004;   // close code of the server for rooms that do not exist (and cannot be created)
const ADMIN_TOKEN_KEY = 'ioroom.adminToken';

// Owner token: taken from ?admin=… (then removed from the URL and remembered), else from localStorage
function readAdminToken() {
    const url = new URL(window.location.href);
    // A query string decodes "+" as a space: tokens are base64-like and never contain spaces, so map them
    // back (a token with "+" pasted unencoded into ?admin= would otherwise be saved wrong -> 401 Unauthorized)
    const fromUrl = url.searchParams.get('admin')?.replaceAll(' ', '+');
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

/*
* Keeps a store list of plain instances ({ id, ... }, replaced immutably on every edit) identical to the
* Y.Map `yMap` (id -> instance, last writer wins per instance). `select(state)` reads the list,
* `replaceAll(list)` writes the room's list into the store. Returns the unbind function.
*/
function bindInstances(doc, yMap, select, replaceAll) {
    let applyingRemote = false; // true while remote state is written into the store (no echo back)

    // local -> room: only what changed (instances are immutable, so a new reference = an edit)
    const push = (list, previous) => {
        const previousRefs = new Set(previous);
        const ids = new Set(list.map((item) => item.id));
        doc.transact(() => {
            for (const item of list) if (!previousRefs.has(item)) yMap.set(item.id, item);
            for (const item of previous) if (!ids.has(item.id)) yMap.delete(item.id);
        }, LOCAL);
    };

    // What this device already has joins the room (new room: it seeds it; existing room: it merges in)
    push(select(useStore.getState()), []);

    const unsubscribe = useStore.subscribe((state, previousState) => {
        const list = select(state);
        const previous = select(previousState);
        if (!applyingRemote && list !== previous) push(list, previous);
    });

    // room -> local
    const pull = (event) => {
        if (event.transaction.origin === LOCAL) return;
        applyingRemote = true;
        replaceAll(Array.from(yMap.values()));
        applyingRemote = false;
    };
    yMap.observe(pull);

    return () => {
        yMap.unobserve(pull);
        unsubscribe();
    };
}

// Connects this device to `room`; returns the disconnect function
export function connectRoom(room) {
    const doc = new Y.Doc();
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
    const unbindObjects = bindInstances(doc, doc.getMap('objects'),
        (state) => state.objects.instances, (list) => useStore.getState().setInstances(list));
    const unbindNotes = bindInstances(doc, doc.getMap('notes'),
        (state) => state.notes.items, (list) => useStore.getState().setNotes(list));
    const unbindAwareness = bindAwareness(provider.awareness);
    const unbindSun = bindSun(doc, provider);
    const unbindSurfaces = bindFieldMap(doc, provider, {
        name: 'surfaces',
        read: (state) => state.surfaces,
        write: (patch) => useStore.getState().setSurfaces(patch)
    });

    return () => {
        setRoomStatus('local');
        unbindAwareness();
        unbindSun();
        unbindSurfaces();
        unbindObjects();
        unbindNotes();
        provider.destroy();
        doc.destroy();
    };
}
