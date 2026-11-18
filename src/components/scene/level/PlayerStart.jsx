import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useStore } from '../../../store/appStore';
import { activeLevel } from '../../../plan/planModel';
import { viewGroundPoint } from './viewGroundProbe';
import { canWalk } from '../controls/walk';
import { groundHeight } from '../xr-ui/teleport';

// Calibration knobs
const AIM_MIN = 0.15; // m dragged from the press before the drag sets the direction (less = the view's direction)
const ORANGE = '#ff9a1a';
const RED = '#ff3c3c';

const noRaycast = () => null;
const _forward = new Vector3();

/*
* PLAYER START (planModel level.playerStart): where the tour (first / third person, WalkControls.jsx) and the
* VR / AR sessions (XRPlayerStart.jsx) start, like Unreal's player start. Inside the Board, flatscreen only.
* - Marker: an upside-down cone over the floor with an arrow towards where it looks; shown in the tour's orbit
*   view (never hit by pointers: notes, ruler and clicks go through it).
* - Tool (store placingStart; admin only, next to the tour views in WorkspaceSwitch.jsx): press on the floor = where (a place to stand,
*   walk.js canWalk: red where not), drag = which way (released without a drag: the view's direction).
*   The press never orbits nor selects (taken on window, capture phase). Saved in the plan: synced, undoable.
*   Esc cancels. Moving it = placing it again.
*/
export default function PlayerStart() {
    const start = useStore((state) => activeLevel(state.plan).playerStart);
    const placing = useStore((state) => state.placingStart);
    // marker: in the tour's orbit view (where the start is prepared), never in first / third person
    const isTourOrbit = useStore((state) => state.workspace === 'tour' && state.tourView === 'orbit');
    const camera = useThree((state) => state.camera);
    const gl = useThree((state) => state.gl);
    const [preview, setPreview] = useState(null); // { p, yaw, valid, pressed }

    useEffect(() => {
        if (!placing) return;
        const viewYaw = () => {
            camera.getWorldDirection(_forward);
            return Math.atan2(-_forward.x, -_forward.z);
        };
        const validAt = (p) => canWalk(activeLevel(useStore.getState().plan), p, useStore.getState().openDoors);
        let pressed = null; // { p, yaw, valid }
        const onCanvas = (event) => event.target === gl.domElement;

        const down = (event) => {
            if (!onCanvas(event) || (event.pointerType === 'mouse' && event.button !== 0)) return;
            event.stopPropagation(); // no orbit, no selection
            const p = viewGroundPoint(event.clientX, event.clientY);
            if (p == null) return;
            pressed = { p, yaw: viewYaw(), valid: validAt(p) };
            setPreview({ ...pressed, pressed: true });
        };
        const move = (event) => {
            const point = viewGroundPoint(event.clientX, event.clientY);
            if (pressed) {
                if (point && Math.hypot(point[0] - pressed.p[0], point[1] - pressed.p[1]) > AIM_MIN) {
                    pressed.yaw = Math.atan2(-(point[0] - pressed.p[0]), -(point[1] - pressed.p[1]));
                }
                setPreview({ ...pressed, pressed: true });
            } else if (event.pointerType === 'mouse') {
                // hover (mouse): the marker follows the cursor, facing the view's way
                setPreview(point && onCanvas(event) ? { p: point, yaw: viewYaw(), valid: validAt(point) } : null);
            }
        };
        const up = () => {
            if (pressed == null) return;
            const { p, yaw, valid } = pressed;
            pressed = null;
            if (!valid) { setPreview(null); return; } // not a place to stand: try again
            useStore.getState().setPlayerStart({ p, yaw });
            useStore.getState().setPlacingStart(false);
        };
        const key = (event) => { if (event.key === 'Escape') useStore.getState().setPlacingStart(false); };
        window.addEventListener('pointerdown', down, true);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('keydown', key);
        document.body.classList.add('placing-note'); // same crosshair as the post-it placing (app.css)
        return () => {
            window.removeEventListener('pointerdown', down, true);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('keydown', key);
            document.body.classList.remove('placing-note');
            setPreview(null);
        };
    }, [placing, camera, gl]);

    const shown = preview ?? (isTourOrbit ? start : null);
    if (shown == null) return null;
    const level = activeLevel(useStore.getState().plan);
    return (
        <Marker p={shown.p} y={groundHeight(level, shown.p)} yaw={shown.yaw}
            color={preview && !preview.valid ? RED : ORANGE} ghost={preview != null && !preview.pressed} />
    );
}

// Upside-down cone (tip 5 cm over the floor) + forward arrow at its top + a ring on the floor
function Marker({ p, y, yaw, color, ghost }) {
    const opacity = ghost ? 0.45 : 0.85;
    return (
        <group position={[p[0], y, p[1]]} rotation-y={yaw}>
            <mesh position={[0, 0.3, 0]} rotation-x={Math.PI} raycast={noRaycast}>
                <coneGeometry args={[0.18, 0.5, 24]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.55, -0.32]} rotation-x={-Math.PI / 2} raycast={noRaycast}>
                <coneGeometry args={[0.08, 0.2, 16]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.55, -0.15]} rotation-x={-Math.PI / 2} raycast={noRaycast}>
                <cylinderGeometry args={[0.025, 0.025, 0.2, 8]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.005, 0]} rotation-x={-Math.PI / 2} raycast={noRaycast}>
                <ringGeometry args={[0.2, 0.24, 40]} />
                <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
            </mesh>
        </group>
    );
}
