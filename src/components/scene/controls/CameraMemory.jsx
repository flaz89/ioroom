import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { getRoomId } from '../../../sync/roomSync';

/*
* CAMERA MEMORY (desktop / mobile 3D view): each device reopens an environment where it left it. The camera's
* position, orbit target and focal offset (CameraControls: the offset keeps the view still when the orbit point
* moves under the cursor, OrbitAtCursor.jsx) are saved in localStorage, one entry per environment
* (?room=<id>, 'local' without one), when the page is hidden or left (reload, tab closed, app backgrounded:
* covers orbit, pan and zoom whenever they happened), and put back once the controls exist (no transition). Per device (browser), never synced: not part of the environment.
* Not saved while in XR (the camera is the headset's then). Storage can be unavailable (private mode, blocked
* site data): then the view simply starts from the default, as before.
* Mounted inside the Canvas, after <CameraControls makeDefault /> (read from the R3F state).
*/
const storageKey = () => `ioroom.camera.${getRoomId() ?? 'local'}`;
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const [position, target, focal] = [new Vector3(), new Vector3(), new Vector3()];

export default function CameraMemory() {
    const controls = useThree((state) => state.controls);
    const gl = useThree((state) => state.gl);
    const restored = useRef(false);

    // put the saved view back, once, as soon as the controls exist
    useEffect(() => {
        if (controls == null || restored.current) return;
        restored.current = true;
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey()));
            if (!isVec3(saved?.position) || !isVec3(saved?.target)) return;
            controls.setLookAt(...saved.position, ...saved.target, false);
            if (isVec3(saved.focal)) controls.setFocalOffset(...saved.focal, false);
        } catch { /* no storage or a broken entry: the default view */ }
    }, [controls]);

    // save on leave / hide (pagehide: reload and close; visibilitychange: mobile backgrounding) and on unmount
    useEffect(() => {
        if (controls == null) return;
        const save = () => {
            if (gl.xr?.isPresenting) return;
            try {
                localStorage.setItem(storageKey(), JSON.stringify({
                    position: controls.getPosition(position).toArray(),
                    target: controls.getTarget(target).toArray(),
                    focal: controls.getFocalOffset(focal).toArray()
                }));
            } catch { /* storage unavailable: not remembered */ }
        };
        const onVisibility = () => { if (document.visibilityState === 'hidden') save(); };
        window.addEventListener('pagehide', save);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('pagehide', save);
            document.removeEventListener('visibilitychange', onVisibility);
            save(); // unmounted: the Canvas is rebuilt for another renderer backend (Scene.jsx key), keep the view
        };
    }, [controls, gl]);

    return null;
}
