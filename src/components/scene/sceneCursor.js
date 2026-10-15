/*
* Mouse cursor over the 3D canvas (desktop): pointer hand over clickable things (objects, notes),
* closed hand while something is being dragged (objects, gizmo, materials from the panel).
* Several sources can be active at once, each under its own key (e.g. an object id); the cursor follows
* "any active". Applied as classes on <body>, styled in app.css (the post-it placing crosshair wins).
* Harmless in XR: there is no mouse cursor there.
*/
const hovered = new Set();
const grabbing = new Set();

function apply() {
    document.body.classList.toggle('scene-hover', hovered.size > 0);
    document.body.classList.toggle('scene-grabbing', grabbing.size > 0);
}

// `key` is under the pointer (on = true) or not anymore
export function setCursorHover(key, on) {
    if (on) hovered.add(key);
    else hovered.delete(key);
    apply();
}

// `key` is being dragged (on = true) or was released
export function setCursorGrabbing(key, on) {
    if (on) grabbing.add(key);
    else grabbing.delete(key);
    apply();
}
