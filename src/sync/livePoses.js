/*
* Live object poses during drags, shared through the room's Yjs AWARENESS (ephemeral: never saved,
* gone when the client leaves). The saved scene (Y.Map "objects", see roomSync.js) still changes only
* on release; awareness only carries the in-between motion so other devices see the object move live.
*
* - the device dragging an object calls publishLivePose(id, position, quaternion, scale) every frame
*   (throttled here) and endLivePose(id) on release;
* - every device reads remotePoses (object id -> { p, q, s }) to follow objects dragged by others.
* Without a room (no awareness bound) publishing is a no-op and remotePoses stays empty.
*/
// ~15 updates/s: receivers ease towards each pose (REMOTE_FOLLOW_RATE in SingleObject.jsx), so motion stays
// smooth. Lower = less traffic but more lag/rounding of fast moves; ~10/s is about the minimum that still reads live.
const PUBLISH_INTERVAL_MS = 66;
const MIN_MOVE = 0.001;      // board meters: smaller position changes are not sent (object held still)
const MIN_TURN = 0.0005;     // 1 - |dot(q, last q)|: smaller rotation changes are not sent

let awareness = null;
let lastPublish = 0;
let lastSent = null; // last published { id, p, q, s }, to skip unchanged poses

// Object id -> last pose received from another device ({ p: [x,y,z], q: [x,y,z,w], s: [x,y,z] })
export const remotePoses = new Map();

// Rebuilds remotePoses from every other client's awareness state
function readRemoteStates() {
    remotePoses.clear();
    for (const [clientId, state] of awareness.getStates()) {
        if (clientId !== awareness.clientID && state.live != null) remotePoses.set(state.live.id, state.live);
    }
}

// Called by connectRoom: starts sharing poses through this awareness; returns the unbind function
export function bindAwareness(roomAwareness) {
    awareness = roomAwareness;
    awareness.on('change', readRemoteStates);
    return () => {
        awareness.off('change', readRemoteStates);
        awareness.setLocalStateField('live', null);
        awareness = null;
        remotePoses.clear();
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
