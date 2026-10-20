/*
* BUILDER 3D clicks (Room.jsx walls, Openings3D.jsx doors / windows): a click selects only when the pointer
* has not moved more than CLICK_SLOP px since its press (the end of an orbit drag is not a click). pmndrs
* events have no usable `delta` (its getter throws), so presses are recorded here by the room's
* onPointerDown (recordPress) and checked on click (isStillClick).
*/
const CLICK_SLOP = 4; // px
const pressPositions = new Map(); // pointerId -> { x, y } screen position of the last press on the room

export function recordPress(event) {
    const native = event.nativeEvent;
    if (native?.clientX != null) pressPositions.set(event.pointerId, { x: native.clientX, y: native.clientY });
}

export function isStillClick(event) {
    const press = pressPositions.get(event.pointerId);
    const native = event.nativeEvent;
    return !(press && native?.clientX != null && Math.hypot(native.clientX - press.x, native.clientY - press.y) > CLICK_SLOP);
}
