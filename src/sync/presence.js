import { useSyncExternalStore } from 'react';
import { removeAwarenessStates } from 'y-protocols/awareness';

/*
* Presence in a shared room, through the room's Yjs AWARENESS (ephemeral: never saved, gone when the
* client leaves or loses the connection). The saved scene (Y.Map "objects", see roomSync.js) is separate.
*
* LIVE POSES: the device dragging an object calls publishLivePose(id, position, quaternion, scale) every
* frame (throttled here) and endLivePose(id) on release; every device reads remotePoses (object id ->
* { p, q, s }) to follow objects dragged by others. The final pose arrives through the saved scene.
*
* LOCKS: holdObject(id) / releaseObject(id) mark the object this device is holding (grab or gizmo).
* An object held by another device is locked here (isLockedByOther / useObjectLock): it cannot be
* grabbed, moved, rotated or deleted, and shows that device's color. If two devices grab the same object
* at the same time, the lower awareness client id wins and the other one gives up.
*
* POINTERS: desktop/mobile devices share where their mouse/touch points in the scene (publishPointer /
* clearPointer, board space); remotePointers (client id -> { p, n }) is read by the in-scene indicators.
*
* AVATARS: headset users share their head and hands/controllers (publishAvatar / clearAvatar, board space,
* plus the avatar scale = 1 / their board scale, so a tabletop user appears as a "giant" over the room);
* remoteAvatars (client id -> { h, l, r, s }) is read by the in-scene avatars.
*
* USERS: each device shares { id, name, color } (name = device type for now); useRoomUsers() lists them,
* ONE entry per device (several tabs / reconnections of the same browser share its id).
* DEVICE IDENTITY (deviceIdentity): id and color are picked once per browser and kept in localStorage, so a
* device keeps its color across reloads, tabs and visits (notes and measures are signed with it). The Yjs
* client id changes at every connection and is only used for the live data (poses, locks, avatars).
*
* HEARTBEAT + TIMEOUT: y-partyserver turns off Yjs' own awareness renewal and timeout (server AND provider),
* so a connection that dies without a clean close (headset asleep, browser killed) would stay in the room
* forever, and the server hands it to every newcomer. Here each device renews its presence every
* HEARTBEAT_MS (a changed field: the provider only sends changes) and drops other clients not heard for
* PRESENCE_TIMEOUT_MS; the removal is sent to the server like any awareness change, so it leaves the
* server's memory and every other device too. The timeout is generous: browsers slow background tabs'
* timers down to about once a minute, and a live hidden tab must not blink in and out of the list.
*
* Without a room (no awareness bound) everything is a no-op: nothing is published, nothing is locked.
*/
// ~15 updates/s: receivers ease towards each pose (REMOTE_FOLLOW_RATE in SingleObject.jsx), so motion stays
// smooth. Lower = less traffic but more lag/rounding of fast moves; ~10/s is about the minimum that still reads live.
const PUBLISH_INTERVAL_MS = 66;
const MIN_MOVE = 0.001;      // board meters: smaller position changes are not sent (object held still)
const MIN_TURN = 0.0005;     // 1 - |dot(q, last q)|: smaller rotation changes are not sent

// Per-device colors (outline of the objects it holds, cursor, avatar, notes and measures it signs)
const USER_COLORS = ['#4fc3f7', '#81c784', '#ba68c8', '#f06292', '#ffd54f', '#4db6ac', '#9575cd', '#e57373'];
const DEVICE_KEY = 'ioroom.device'; // localStorage: { id, color } of this browser
const HEARTBEAT_MS = 15000;          // presence renewal (also how often stale clients are checked)
const PRESENCE_TIMEOUT_MS = 75000;   // a client not heard for this long is gone

/*
* This browser's identity { id, color }: read from localStorage, or created once (random id, random palette
* color) and saved. Storage blocked (private mode): a new identity for this visit only.
* ponytail: a random color, two devices can get the same one; with accounts the color becomes the user's.
*/
let identity = null;
export function deviceIdentity() {
    if (identity != null) return identity;
    try {
        const saved = JSON.parse(localStorage.getItem(DEVICE_KEY));
        if (typeof saved?.id === 'string' && USER_COLORS.includes(saved.color)) identity = saved;
    } catch { /* storage blocked or corrupted: a new identity below */ }
    if (identity == null) {
        identity = { id: crypto.randomUUID(), color: USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)] };
        try { localStorage.setItem(DEVICE_KEY, JSON.stringify(identity)); } catch { /* this visit only */ }
    }
    return identity;
}

let awareness = null;
let lastPublish = 0;
let lastSent = null; // last published { id, p, q, s }, to skip unchanged poses

// Object id -> last pose received from another device ({ p: [x,y,z], q: [x,y,z,w], s: [x,y,z] })
export const remotePoses = new Map();
// Client id -> where that device points in the scene ({ p: [x,y,z] point, n: [x,y,z] surface normal }, board space)
export const remotePointers = new Map();
// Client id -> headset pose ({ h, l, r: [px,py,pz, qx,qy,qz,qw] or null for a missing hand, s: scale }, board space)
export const remoteAvatars = new Map();
// Object id -> the other device holding it with the lowest client id ({ clientId, color })
const remoteHolders = new Map();
// Everyone in the room, this device first: [{ clientId, name, color, isSelf }] (rebuilt on every change,
// so React can compare it by reference)
let roomUsers = [];
// React subscribers (useObjectLock, useRoomUsers), notified when presence may have changed
const listeners = new Set();

// Device label from the user agent, until people have names/accounts (e.g. "Quest 3", "iPhone", "Mac")
function deviceName() {
    const agent = navigator.userAgent;
    const quest = agent.match(/Quest\s?(Pro|\d+)?/);
    if (quest) return quest[0].trim();
    if (/iPad/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone/.test(agent)) return 'iPhone';
    if (/Android/.test(agent)) return /Mobile/.test(agent) ? 'Android phone' : 'Android tablet';
    if (/Macintosh/.test(agent)) return 'Mac';
    if (/Windows/.test(agent)) return 'Windows PC';
    if (/Linux/.test(agent)) return 'Linux PC';
    return 'Device';
}

// Rebuilds remotePoses / remoteHolders from every other client's awareness state
function readRemoteStates() {
    remotePoses.clear();
    remoteHolders.clear();
    remotePointers.clear();
    remoteAvatars.clear();
    const users = new Map(); // device id (older clients without one: client id) -> user, one per device
    for (const [clientId, state] of awareness.getStates()) {
        if (state.user != null) {
            const key = state.user.id ?? `client:${clientId}`;
            const isSelf = clientId === awareness.clientID;
            // one entry per device: this connection for its own device, else the first one seen
            if (isSelf || !users.has(key)) users.set(key, { clientId, name: state.user.name, color: state.user.color, isSelf });
        }
        if (clientId === awareness.clientID) continue;
        if (state.live != null) remotePoses.set(state.live.id, state.live);
        if (state.pointer != null) remotePointers.set(clientId, state.pointer);
        if (state.avatar != null) remoteAvatars.set(clientId, state.avatar);
        const held = state.holding;
        if (held != null && !(remoteHolders.get(held)?.clientId < clientId)) {
            remoteHolders.set(held, { clientId, color: state.user?.color ?? '#ffffff' });
        }
    }
    roomUsers = [...users.values()].sort((a, b) => (b.isSelf - a.isSelf) || (a.clientId - b.clientId));
    for (const listener of listeners) listener();
}

/*
* The other clients not heard for more than PRESENCE_TIMEOUT_MS at `now` (ms), from `lastHeard` (client id
* -> ms). A client never heard yet (known before this device bound the awareness) starts counting now:
* it is added to `lastHeard`.
*/
export function staleClients(clientIds, selfId, lastHeard, now) {
    const stale = [];
    for (const clientId of clientIds) {
        if (clientId === selfId) continue;
        if (!lastHeard.has(clientId)) lastHeard.set(clientId, now);
        else if (now - lastHeard.get(clientId) > PRESENCE_TIMEOUT_MS) stale.push(clientId);
    }
    return stale;
}

// Called by connectRoom: starts sharing poses through this awareness; returns the unbind function
export function bindAwareness(roomAwareness) {
    awareness = roomAwareness;
    const { id, color } = deviceIdentity();
    awareness.setLocalStateField('user', { id, name: deviceName(), color });
    awareness.on('change', readRemoteStates);
    readRemoteStates();

    // heartbeat + timeout (see the header): last time each client was heard ('update' also fires for
    // unchanged renewals)
    const lastHeard = new Map();
    const onUpdate = ({ added, updated }) => {
        const now = Date.now();
        for (const clientId of [...added, ...updated]) lastHeard.set(clientId, now);
    };
    awareness.on('update', onUpdate);
    const heartbeat = setInterval(() => {
        const now = Date.now();
        awareness.setLocalStateField('seen', now); // renews this device
        const stale = staleClients([...awareness.getStates().keys()], awareness.clientID, lastHeard, now);
        if (stale.length > 0) {
            stale.forEach((clientId) => lastHeard.delete(clientId));
            removeAwarenessStates(awareness, stale, 'timeout'); // also sent to the server and the others
        }
    }, HEARTBEAT_MS);

    return () => {
        clearInterval(heartbeat);
        awareness.off('update', onUpdate);
        awareness.off('change', readRemoteStates);
        awareness.setLocalStateField('live', null);
        awareness.setLocalStateField('holding', null);
        awareness.setLocalStateField('pointer', null);
        awareness.setLocalStateField('avatar', null);
        awareness = null;
        remotePoses.clear();
        remoteHolders.clear();
        remotePointers.clear();
        remoteAvatars.clear();
        roomUsers = [];
        for (const listener of listeners) listener();
    };
}

// Board-space pose of the object being dragged on this device (THREE.Vector3 / Quaternion / Vector3)
export function publishLivePose(id, position, quaternion, scale) {
    if (awareness == null) return;
    const now = performance.now();
    if (now - lastPublish < PUBLISH_INTERVAL_MS) return;
    if (lastSent?.id === id && !hasMoved(lastSent, position, quaternion, scale)) return; // nothing new to send
    lastPublish = now;
    lastSent = { id, p: position.toArray(), q: quaternion.toArray(), s: scale.toArray() };
    awareness.setLocalStateField('live', lastSent);
}

// Drag of `id` ended on this device (the final pose arrives through the saved scene)
export function endLivePose(id) {
    if (awareness?.getLocalState()?.live?.id !== id) return;
    awareness.setLocalStateField('live', null);
    lastPublish = 0;
    lastSent = null;
}

// Whether the pose changed enough since the last one sent
function hasMoved(last, position, quaternion, scale) {
    const [px, py, pz] = last.p;
    const [qx, qy, qz, qw] = last.q;
    const [sx, sy, sz] = last.s;
    const moved = Math.hypot(position.x - px, position.y - py, position.z - pz) > MIN_MOVE;
    const turned = 1 - Math.abs(quaternion.x * qx + quaternion.y * qy + quaternion.z * qz + quaternion.w * qw) > MIN_TURN;
    const scaled = Math.hypot(scale.x - sx, scale.y - sy, scale.z - sz) > MIN_MOVE;
    return moved || turned || scaled;
}

// POINTERS ---------------------------------------------------------------------------------------

let lastPointerPublish = 0;
let lastPointer = null; // last published { p, n }

// Where this device's mouse/touch points (board-space THREE.Vector3 point + normal); throttled, change-only
export function publishPointer(point, normal) {
    if (awareness == null) return;
    const now = performance.now();
    if (now - lastPointerPublish < PUBLISH_INTERVAL_MS) return;
    if (lastPointer != null && Math.hypot(point.x - lastPointer.p[0], point.y - lastPointer.p[1], point.z - lastPointer.p[2]) <= MIN_MOVE) return;
    lastPointerPublish = now;
    lastPointer = { p: point.toArray(), n: normal.toArray() };
    awareness.setLocalStateField('pointer', lastPointer);
}

// The pointer left the scene (off the canvas, or pointing at nothing)
export function clearPointer() {
    if (awareness == null || lastPointer == null) return;
    lastPointer = null;
    awareness.setLocalStateField('pointer', null);
}

// AVATARS ----------------------------------------------------------------------------------------

let lastAvatarPublish = 0;
let lastAvatar = null; // last published { h, l, r, s }

// Largest position change (meters) between two [px,py,pz,…] poses; a hand appearing/disappearing counts as a change
function poseDelta(a, b) {
    if (a == null || b == null) return a === b ? 0 : Infinity;
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) + Math.hypot(a[3] - b[3], a[4] - b[4], a[5] - b[5], a[6] - b[6]);
}

// This headset's pose: head / left / right as [px,py,pz, qx,qy,qz,qw] (board space, hands may be null),
// scale = avatar scale (1 / board scale). Throttled, and skipped while everything stays still.
export function publishAvatar(head, left, right, scale) {
    if (awareness == null) return;
    const now = performance.now();
    if (now - lastAvatarPublish < PUBLISH_INTERVAL_MS) return;
    if (lastAvatar != null && Math.abs(lastAvatar.s - scale) < 1e-4
        && Math.max(poseDelta(head, lastAvatar.h), poseDelta(left, lastAvatar.l), poseDelta(right, lastAvatar.r)) <= MIN_MOVE * scale) return;
    lastAvatarPublish = now;
    lastAvatar = { h: head, l: left, r: right, s: scale };
    awareness.setLocalStateField('avatar', lastAvatar);
}

// This device left the headset session
export function clearAvatar() {
    if (awareness == null || lastAvatar == null) return;
    lastAvatar = null;
    awareness.setLocalStateField('avatar', null);
}

// LOCKS ------------------------------------------------------------------------------------------

// This device starts holding `id` (grab or gizmo drag)
export function holdObject(id) {
    awareness?.setLocalStateField('holding', id);
}

// This device stops holding `id`
export function releaseObject(id) {
    if (awareness?.getLocalState()?.holding === id) awareness.setLocalStateField('holding', null);
}

// Whether another device owns `id`: it holds it, and this device either does not hold it or lost the tie
export function isLockedByOther(id) {
    const holder = remoteHolders.get(id);
    if (holder == null) return false;
    const holdingHere = awareness?.getLocalState()?.holding === id;
    return !holdingHere || holder.clientId < awareness.clientID;
}

const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

// React: color of the other device that owns `id`, or null when the object is free here
export function useObjectLock(id) {
    return useSyncExternalStore(subscribe, () => (isLockedByOther(id) ? remoteHolders.get(id).color : null));
}

// USERS ------------------------------------------------------------------------------------------

// This device's { id, name, color }: the same in a room and in local mode (deviceIdentity)
export function getSelfUser() {
    return awareness?.getLocalState()?.user ?? { id: deviceIdentity().id, name: deviceName(), color: deviceIdentity().color };
}

// React: this device's presence color, or null without a room
export function useSelfColor() {
    return useSyncExternalStore(subscribe, () => roomUsers.find((user) => user.isSelf)?.color ?? null);
}

// Everyone in the room right now, one entry per device, this device first (non-React reads, checks)
export const getRoomUsers = () => roomUsers;

// React: everyone in the room, this device first ([] without a room)
export function useRoomUsers() {
    return useSyncExternalStore(subscribe, () => roomUsers);
}
