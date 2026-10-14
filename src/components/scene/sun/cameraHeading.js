import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';

/*
* Camera heading for DOM widgets (the compass bar, components/ui/compass/CompassBar.jsx), without React
* re-renders: <CameraHeadingTracker> (inside the Canvas) publishes it, subscribeCameraHeading() listens.
*
* Heading = ROOM bearing of the view direction, in degrees, clockwise seen from above from the room's -Z
* axis (same convention as sunDirection in sun.js): 0 = looking at the back wall, 90 = towards +X.
* The geographic heading is roomBearing - northDeg (store sun.northDeg).
* Follows the active camera: the orbit camera on flatscreen, the headset during XR sessions.
* ponytail: in tabletop mode a board turned by hand is not taken into account.
*/
const listeners = new Set();
let heading = 0;
const MIN_CHANGE = 0.05; // degrees: below this, no notification (camera still)
const _forward = new Vector3();

export function subscribeCameraHeading(listener) {
    listeners.add(listener);
    listener(heading);
    return () => listeners.delete(listener);
}

export function CameraHeadingTracker() {
    useFrame(({ camera }) => {
        camera.getWorldDirection(_forward);
        // Looking straight down/up: the horizontal direction is undefined, keep the last heading
        if (Math.abs(_forward.x) + Math.abs(_forward.z) < 1e-4) return;
        const next = Math.atan2(_forward.x, -_forward.z) * 180 / Math.PI;
        if (Math.abs(next - heading) < MIN_CHANGE) return;
        heading = next;
        listeners.forEach((listener) => listener(heading));
    });
    return null;
}
