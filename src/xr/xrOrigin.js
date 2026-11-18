import { Matrix4, Quaternion, Vector3 } from 'three';

/*
* XR ORIGIN: where the headset's real space sits in the world, shared by the teleport (TeleportGesture.jsx) and
* the player start (XRPlayerStart.jsx). origin { p: [x, z], yaw } (teleport.js: world = rotateY(base, yaw) + p)
* and y = the floor stood on (raised floors). Applied by replacing the XR reference space with an OFFSET space of
* the session's base space (gl.xr.setReferenceSpace): camera, hands, pmndrs pointers and every pose read with
* gl.xr.getReferenceSpace() follow, untouched. Poses in the offset space are the offset transform's inverse
* times the base poses, so the transform is the inverse of the world placement. Kept per session (three.js
* drops the custom space on a new session, and so does this).
*/
const UP = new Vector3(0, 1, 0);
const ONE = new Vector3(1, 1, 1);
const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const state = { session: null, base: null, origin: { p: [0, 0], yaw: 0 }, y: 0 };

function current(gl) {
    const session = gl.xr.getSession();
    if (state.session !== session) Object.assign(state, { session, base: gl.xr.getReferenceSpace(), origin: { p: [0, 0], yaw: 0 }, y: 0 });
    return state;
}

export const getXROrigin = (gl) => current(gl).origin;
// the session's own space (before any teleport / start), to read the real head pose
export const getXRBaseSpace = (gl) => current(gl).base;

export function setXROrigin(gl, origin, y) {
    const s = current(gl);
    Object.assign(s, { origin, y });
    _m.compose(_p.set(origin.p[0], y, origin.p[1]), _q.setFromAxisAngle(UP, origin.yaw), ONE).invert().decompose(_p, _q, _s);
    gl.xr.setReferenceSpace(s.base.getOffsetReferenceSpace(new XRRigidTransform(
        { x: _p.x, y: _p.y, z: _p.z }, { x: _q.x, y: _q.y, z: _q.z, w: _q.w }
    )));
}
