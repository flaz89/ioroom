/*
* Bridge between the DOM and the 3D scene for material drag & drop (ui/materials-panel/): the DOM side
* asks which room surface is under a screen point, the scene side (MaterialDropTarget.jsx, inside the
* Canvas) answers. Without a mounted scene (XR session, remount) it answers null.
*/
let picker = null;

// Scene side: register (fn(clientX, clientY) -> surfaceId | null), or clear with null
export function setSurfacePicker(fn) {
    picker = fn;
}

// DOM side: surface id under the screen point, null when none (or something else is in front)
export function pickSurfaceAt(clientX, clientY) {
    return picker?.(clientX, clientY) ?? null;
}
