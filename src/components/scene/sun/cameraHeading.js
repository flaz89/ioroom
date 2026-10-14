/*
* Camera heading for widgets that must not re-render every frame (the DOM compass bar, the VR compass
* bar): <CameraHeadingTracker> (inside the Board) publishes it, subscribeCameraHeading() listens.
*
* Heading = ROOM bearing of the view direction, in degrees, clockwise seen from above from the room's -Z
* axis (same convention as sunDirection in sun.js): 0 = looking at the back wall, 90 = towards +X.
* The geographic heading is roomBearing - northDeg (store sun.northDeg).
*/
const listeners = new Set();
let heading = 0;

export function subscribeCameraHeading(listener) {
    listeners.add(listener);
    listener(heading);
    return () => listeners.delete(listener);
}

export function publishCameraHeading(next) {
    heading = next;
    listeners.forEach((listener) => listener(heading));
}

export const getCameraHeading = () => heading;
