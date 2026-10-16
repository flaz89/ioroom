import { Vector3 } from 'three';

/*
* userData of the background of every in-VR world panel (sun, materials, notes, measure): tools that read
* the session's select event directly (the ruler) ignore selects aimed at a panel (pressing its buttons).
*/
export const VR_PANEL = { vrPanel: true };

// Shared sizes for the in-VR UI, in meters
export const BUTTON_SIZE = [0.026, 0.026]; // wrist menu buttons [width, height] (square: icons, short values)

const _eye = new Vector3();
const _forward = new Vector3();

/*
* Places an in-VR panel (`group`) in the world, in front of the user and a bit below the eyes, facing
* them (a plane's front, +Z, towards the eyes). Called once when the panel opens: it then stays put.
* `camera` follows the headset during XR sessions. distance / belowEyes in meters.
*/
export function placeInFrontOfUser(group, camera, distance, belowEyes) {
    camera.getWorldPosition(_eye);
    camera.getWorldDirection(_forward).setY(0);
    if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1); // looking straight down
    _forward.normalize();
    group.position.set(_eye.x + _forward.x * distance, _eye.y - belowEyes, _eye.z + _forward.z * distance);
    group.lookAt(_eye);
}
