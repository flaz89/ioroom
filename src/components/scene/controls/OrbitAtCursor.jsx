import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';

/*
* ORBIT AROUND THE CURSOR (desktop / mobile 3D view, like SketchUp / Twinmotion): when a camera ROTATION (left
* mouse button, or the first finger on touch) or PAN (right button) starts, the orbit point becomes the spot under
* the pointer, WITHOUT moving the view (CameraControls.setOrbitPoint keeps the camera where it is through its focal
* offset). Rotation: every one turns around what was clicked, panning never leaves the pivot somewhere odd. Pan:
* camera-controls pans at a speed proportional to the distance to the orbit point, so with the point under the
* cursor the grabbed spot follows the mouse (like a CAD), close up or far away; with a stale, very close point
* (after zooming in) the pan would crawl.
* The spot: the first visible mesh under the pointer (walls, floor, furniture, doors...), else the floor plane
* (y = 0). A hit ABOVE the camera falls back to the floor plane too: the orbit point must stay below the camera,
* or the max polar angle (never below the horizon, Scene.jsx) would snap the view up. Nothing usable (looking at
* the sky) or out of the min / max distance = the orbit point is left as it was.
* The press is recorded on window (capture: before the controls' own pointerdown) and used at 'controlstart',
* so only presses that really start a camera move count (an object or gizmo grab disables the controls first).
* Not in XR (the headset owns the camera). Must be inside the Canvas, after <CameraControls makeDefault />.
* ponytail: raycasts the whole scene on each press (a few hundred meshes); use a BVH with the GLB furniture.
*/
const raycaster = new Raycaster();
const ndc = new Vector2();
const FLOOR = new Plane(new Vector3(0, 1, 0), 0);
const floorHit = new Vector3();
const position = new Vector3();
const BELOW_CAMERA = 0.05; // meters: an orbit point at least this much under the camera

// shown = the object and all its parents visible
const isShown = (object) => {
    for (let item = object; item; item = item.parent) if (!item.visible) return false;
    return true;
};

export default function OrbitAtCursor() {
    const controls = useThree((state) => state.controls);
    const camera = useThree((state) => state.camera);
    const scene = useThree((state) => state.scene);
    const gl = useThree((state) => state.gl);

    useEffect(() => {
        if (controls?.setOrbitPoint == null) return; // not CameraControls
        let press = null; // { x, y, button } of the last primary press
        const onDown = (event) => { if (event.isPrimary) press = { x: event.clientX, y: event.clientY, button: event.button }; };
        const onStart = () => {
            // a press counts once: a later wheel zoom (also a 'controlstart') must not reuse it
            const current = press;
            press = null;
            // left button / first finger (rotate), right button (pan); not the middle one (zoom: dollyToCursor)
            if (current == null || (current.button !== 0 && current.button !== 2) || gl.xr?.isPresenting) return;
            const rect = gl.domElement.getBoundingClientRect();
            ndc.set(((current.x - rect.left) / rect.width) * 2 - 1, -((current.y - rect.top) / rect.height) * 2 + 1);
            raycaster.setFromCamera(ndc, camera);
            controls.getPosition(position);
            const hit = raycaster.intersectObject(scene, true).find((item) => item.object.isMesh && isShown(item.object))?.point;
            const point = hit && hit.y < position.y - BELOW_CAMERA ? hit
                : raycaster.ray.intersectPlane(FLOOR, floorHit) && floorHit.y < position.y - BELOW_CAMERA ? floorHit : null;
            if (point == null) return;
            const distance = point.distanceTo(position);
            if (distance < controls.minDistance || distance > controls.maxDistance) return;
            controls.setOrbitPoint(point.x, point.y, point.z);
        };
        window.addEventListener('pointerdown', onDown, true);
        controls.addEventListener('controlstart', onStart);
        return () => {
            window.removeEventListener('pointerdown', onDown, true);
            controls.removeEventListener('controlstart', onStart);
        };
    }, [controls, camera, scene, gl]);

    return null;
}
