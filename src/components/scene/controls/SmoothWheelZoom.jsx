import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

const WHEEL_SPEED = 0.0015; // zoom factor per wheel delta unit (exp scale: same feel in and out)
const SMOOTHING = 12;       // 1/s: how fast the camera closes on the wanted distance (~0.25 s to settle)
const SETTLED = 1e-3;       // meters: closer than this the zoom is done

/*
* SMOOTH (DAMPED) WHEEL ZOOM for the desktop 3D view: the wheel sets the camera distance to reach (from the
* orbit target, within the OrbitControls' min / max distance) and the camera glides there, frame by frame
* (exponential easing, frame-rate independent). OrbitControls' own wheel zoom moves in one jump: its wheel
* events are taken first here (capture phase on the canvas' parent) and stopped. Pinch zoom on touch is still
* OrbitControls' own. Idle when nothing is zooming: no work per frame beyond one check.
* Must be inside the Canvas, after <OrbitControls makeDefault /> (reads the default controls).
*/
export default function SmoothWheelZoom() {
    const gl = useThree((state) => state.gl);
    const controls = useThree((state) => state.controls);
    const wanted = useRef(null); // distance to reach, null = not zooming

    useEffect(() => {
        const host = gl.domElement.parentElement;
        if (host == null || controls == null) return;
        const onWheel = (event) => {
            if (event.target !== gl.domElement || !controls.enabled) return; // only wheels on the 3D canvas
            event.preventDefault();
            event.stopPropagation(); // OrbitControls (on the canvas) never sees it: no jump
            const current = controls.object.position.distanceTo(controls.target);
            const from = wanted.current ?? current;
            const next = from * Math.exp(event.deltaY * WHEEL_SPEED);
            wanted.current = Math.min(controls.maxDistance, Math.max(controls.minDistance, next));
        };
        host.addEventListener('wheel', onWheel, { capture: true, passive: false });
        return () => host.removeEventListener('wheel', onWheel, { capture: true });
    }, [gl, controls]);

    useFrame((_, delta) => {
        if (wanted.current == null || controls == null) return;
        const camera = controls.object;
        const offset = camera.position.clone().sub(controls.target);
        const current = offset.length();
        const goal = Math.min(controls.maxDistance, Math.max(controls.minDistance, wanted.current));
        const next = current + (goal - current) * (1 - Math.exp(-SMOOTHING * delta));
        camera.position.copy(controls.target).add(offset.setLength(next));
        controls.update();
        if (Math.abs(goal - next) < SETTLED) wanted.current = null;
    });

    return null;
}
