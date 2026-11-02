/*
* Bridge between the DOM and the 3D scene for the "+" menu (ui/catalog-menu/): where the center of the view
* meets the floor plane, in board meters [x, z] (null when it looks at the sky, or without a mounted scene).
* Answered by ViewGround.jsx inside the Board (desktop / mobile); models/spawnPoint.js decides whether that
* point is usable.
*/
let probe = null;

// Scene side: register (fn() -> [x, z] | null), or clear with null
export function setViewGroundProbe(fn) {
    probe = fn;
}

// DOM side
export const viewGroundPoint = () => probe?.() ?? null;
