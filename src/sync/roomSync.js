import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { useStore } from '../store/appStore';
import { AWAY_DISCONNECT_MS, bindAwareness, onAwayChange } from './presence';
import { bindSun } from './sunSync';
import { bindFieldMap } from './fieldMapSync';
import { LOCAL, SEED, isOwnOrigin, startHistory } from './history';

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
* Saved ruler measures (store measures.items, see store/slices/measuresSlice.js): same, Y.Map "measures".
* Selection, grab state and settings stay per device. Live motion during drags and object locks: see presence.js.
* Sun settings of the environment (location, north, day, time): see sunSync.js.
* Look of the environment (store look: exposure, environment light): Y.Map "look", one key per field.
* Materials of the room surfaces (store surfaces): Y.Map "surfaces", one key per surface (fieldMapSync.js).
* Styles of door / window parts (store partStyles, e.g. the handle type): Y.Map "partStyles", one key per part.
* Prices frozen in the project (store priceSnapshots, bill of quantities): Y.Map "prices", one key per material.
* Floor plan (store plan: levels with walls and floors, plan/planModel.js): Y.Map "plan" (fieldMapSync.js,
* key "levels"); a room without one is seeded with the local (default) plan.
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

// ROOM STATUS (React: useRoomStatus): 'local' (no room) | 'connecting' | 'connected' | 'synced' (connected
// and the room's content received: the scene shows the real environment) | 'not-found' |
// 'elsewhere' (the room was opened in another tab of this browser: this one disconnected)
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
    const push = (list, previous, origin = LOCAL) => {
        const previousRefs = new Set(previous);
        const ids = new Set(list.map((item) => item.id));
        doc.transact(() => {
            for (const item of list) if (!previousRefs.has(item)) yMap.set(item.id, item);
            for (const item of previous) if (!ids.has(item.id)) yMap.delete(item.id);
        }, origin);
    };

    // What this device already has joins the room (new room: it seeds it; existing room: it merges in)
    push(select(useStore.getState()), [], SEED); // not an undoable edit (history.js)

    const unsubscribe = useStore.subscribe((state, previousState) => {
        const list = select(state);
        const previous = select(previousState);
        if (!applyingRemote && list !== previous) push(list, previous);
    });

    // room -> local
    const pull = (event) => {
        if (isOwnOrigin(event.transaction.origin)) return;
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

/*
* Creates the environment document and binds the store to it; returns the disconnect function.
* room: id of the shared room to join, or null (local mode: same document and bindings, no provider, so
* the scene is not shared). The document always exists so that undo / redo (history.js) works the same
* with and without a room.
*/
export function connectRoom(room) {
    const doc = new Y.Doc();
    const provider = room != null ? new YProvider(SYNC_HOST, room, doc, { party: PARTY }) : null;

    // Status for the UI; a room that does not exist stops the reconnection attempts
    if (provider) {
        setRoomStatus('connecting');
        provider.on('status', ({ status }) => {
            if (status === 'connected') setRoomStatus('connected');
        });
        // first (and every re-) sync done: the document holds the room's content (loading screen)
        provider.on('sync', (isSynced) => {
            if (isSynced) setRoomStatus('synced');
        });
        provider.on('connection-close', (event) => {
            if (event?.code !== ROOM_NOT_FOUND) return;
            provider.disconnect();
            setRoomStatus('not-found');
        });
    }
    /*
    * ONE CONNECTION PER DEVICE: a tab joining a room tells the other tabs of this browser (same origin,
    * BroadcastChannel) that already have it open; they disconnect (their presence leaves the room) and show
    * a notice. Old tabs left open (e.g. the headset browser keeps one per opened link) no longer show up
    * as extra users. The newest tab always wins: reloading an old tab takes the room back.
    */
    const tabs = provider && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`ioroom.room.${room}`) : null;
    if (tabs) {
        tabs.onmessage = () => {
            provider.disconnect();
            setRoomStatus('elsewhere');
        };
        tabs.postMessage('joined');
    }

    /*
    * AWAY (presence.js): away for AWAY_DISCONNECT_MS (hidden page, headset in standby or off the head) =
    * leave the room (the server removes this presence at once); back = join again (Yjs merges whatever
    * was edited meanwhile). A tab taken over by another one ('elsewhere') stays out.
    */
    let awayTimer = null;
    let leftWhileAway = false;
    const unsubscribeAway = provider ? onAwayChange((isAway) => {
        clearTimeout(awayTimer);
        if (isAway) {
            awayTimer = setTimeout(() => {
                if (roomStatus === 'elsewhere') return;
                leftWhileAway = true;
                provider.disconnect();
            }, AWAY_DISCONNECT_MS);
        } else if (leftWhileAway && roomStatus !== 'elsewhere') {
            leftWhileAway = false;
            provider.connect();
        }
    }) : () => {};

    const unbindObjects = bindInstances(doc, doc.getMap('objects'),
        (state) => state.objects.instances, (list) => useStore.getState().setInstances(list));
    const unbindNotes = bindInstances(doc, doc.getMap('notes'),
        (state) => state.notes.items, (list) => useStore.getState().setNotes(list));
    const unbindMeasures = bindInstances(doc, doc.getMap('measures'),
        (state) => state.measures.items, (list) => useStore.getState().setMeasureItems(list));
    const unbindAwareness = provider ? bindAwareness(provider.awareness) : () => {};
    const unbindSun = bindSun(doc, provider);
    const unbindSurfaces = bindFieldMap(doc, provider, {
        name: 'surfaces',
        read: (state) => state.surfaces,
        write: (values) => useStore.getState().setSurfaces(values)
    });

    const unbindPartStyles = bindFieldMap(doc, provider, {
        name: 'partStyles',
        read: (state) => state.partStyles,
        write: (values) => useStore.getState().setPartStyles(values)
    });

    const unbindPlan = bindFieldMap(doc, provider, {
        name: 'plan',
        read: (state) => state.plan,
        write: (patch) => useStore.getState().setPlan(patch)
    });
    // open / closed doors: shared, never in the undo history (history.js TRACKED_MAPS)
    const unbindDoors = bindFieldMap(doc, provider, {
        name: 'doors',
        read: (state) => state.openDoors,
        write: (values) => useStore.getState().setOpenDoors(values)
    });
    // look of the environment (exposure, environment light): shared, never in the undo history
    const unbindLook = bindFieldMap(doc, provider, {
        name: 'look',
        read: (state) => state.look,
        write: (values) => useStore.getState().setLook(values)
    });
    const unbindPrices = bindFieldMap(doc, provider, {
        name: 'prices',
        read: (state) => state.priceSnapshots,
        write: (values) => useStore.getState().setPriceSnapshots(values)
    });

    // after the bindings: their seeding transactions (SEED) are not recorded anyway
    const stopHistory = startHistory(doc);

    return () => {
        setRoomStatus('local');
        stopHistory();
        unbindPrices();
        unbindLook();
        unbindDoors();
        unbindPlan();
        unbindAwareness();
        unbindSun();
        unbindSurfaces();
        unbindPartStyles();
        unbindObjects();
        unbindNotes();
        unbindMeasures();
        tabs?.close();
        clearTimeout(awayTimer);
        unsubscribeAway();
        provider?.destroy();
        doc.destroy();
    };
}
