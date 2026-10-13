import { useSyncExternalStore } from 'react';

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
* USERS: each device shares { name, color } (name = device type for now); useRoomUsers() lists them.
*
* Without a room (no awareness bound) everything is a no-op: nothing is published, nothing is locked.
*/
// ~15 updates/s: receivers ease towards each pose (REMOTE_FOLLOW_RATE in SingleObject.jsx), so motion stays
// smooth. Lower = less traffic but more lag/rounding of fast moves; ~10/s is about the minimum that still reads live.
const PUBLISH_INTERVAL_MS = 66;
const MIN_MOVE = 0.001;      // board meters: smaller position changes are not sent (object held still)
const MIN_TURN = 0.0005;     // 1 - |dot(q, last q)|: smaller rotation changes are not sent

// Per-device colors (outline of the objects it holds, later its cursor/avatar): picked from the client id
const USER_COLORS = ['#4fc3f7', '#81c784', '#ba68c8', '#f06292', '#ffd54f', '#4db6ac', '#9575cd', '#e57373'];

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
    const users = [];
    for (const [clientId, state] of awareness.getStates()) {
        if (state.user != null) {
            users.push({ clientId, name: state.user.name, color: state.user.color, isSelf: clientId === awareness.clientID });
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
    roomUsers = users.sort((a, b) => (b.isSelf - a.isSelf) || (a.clientId - b.clientId));
    for (const listener of listeners) listener();
}

// Called by connectRoom: starts sharing poses through this awareness; returns the unbind function
export function bindAwareness(roomAwareness) {
    awareness = roomAwareness;
    awareness.setLocalStateField('user', { name: deviceName(), color: USER_COLORS[awareness.clientID % USER_COLORS.length] });
    awareness.on('change', readRemoteStates);
    readRemoteStates();
    return () => {
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

// React: this device's presence color, or null without a room
export function useSelfColor() {
    return useSyncExternalStore(subscribe, () => roomUsers.find((user) => user.isSelf)?.color ?? null);
}

// React: everyone in the room, this device first ([] without a room)
export function useRoomUsers() {
    return useSyncExternalStore(subscribe, () => roomUsers);
}
