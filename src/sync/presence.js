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
// Object id -> the other device holding it with the lowest client id ({ clientId, color })
const remoteHolders = new Map();
// React subscribers (useObjectLock), notified when locks may have changed
const listeners = new Set();

// Rebuilds remotePoses / remoteHolders from every other client's awareness state
function readRemoteStates() {
    remotePoses.clear();
    remoteHolders.clear();
    for (const [clientId, state] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue;
        if (state.live != null) remotePoses.set(state.live.id, state.live);
        const held = state.holding;
        if (held != null && !(remoteHolders.get(held)?.clientId < clientId)) {
            remoteHolders.set(held, { clientId, color: state.user?.color ?? '#ffffff' });
        }
    }
    for (const listener of listeners) listener();
}

// Called by connectRoom: starts sharing poses through this awareness; returns the unbind function
export function bindAwareness(roomAwareness) {
    awareness = roomAwareness;
    awareness.setLocalStateField('user', { color: USER_COLORS[awareness.clientID % USER_COLORS.length] });
    awareness.on('change', readRemoteStates);
    readRemoteStates();
    return () => {
        awareness.off('change', readRemoteStates);
        awareness.setLocalStateField('live', null);
        awareness.setLocalStateField('holding', null);
        awareness = null;
        remotePoses.clear();
        remoteHolders.clear();
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

// React: color of the other device that owns `id`, or null when the object is free here
export function useObjectLock(id) {
    return useSyncExternalStore(
        (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        () => (isLockedByOther(id) ? remoteHolders.get(id).color : null)
    );
}
