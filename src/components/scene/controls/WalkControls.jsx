import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useStore } from '../../../store/appStore';
import { activeLevel, levelBounds } from '../../../plan/planModel';
import { useSelfColor } from '../../../sync/presence';
import { wakeRender } from '../perf/renderWake';
import { EYE_HEIGHT, boomLength, ceilingAt, eyeHeight, standingPoint, walkInput, walkStep } from './walk';
import { groundHeight } from '../xr-ui/teleport';

// Calibration knobs
const WALK_SPEED = 1.4;     // m/s (a calm walk); Shift = RUN_FACTOR
const RUN_FACTOR = 2.2;
const ACCELERATION = 10;    // 1/s: how fast the speed follows the input (smooth start / stop)
const LOOK_SPEED = 0.004;   // rad per pixel dragged (mouse)
const TOUCH_LOOK_SPEED = 0.006;
const PITCH = { first: [-1.45, 1.45], third: [-0.5, 1.2] }; // rad, [up, down]: positive pitch looks DOWN here
const LOOK_EASE = 12;       // 1/s (~80 ms; higher = snappier, less filtered): the view follows the dragged direction (pointer events and frames do not
                            // come in step: turning straight from the events jerked, mostly while walking)
const HEIGHT_EASE = 8;      // 1/s: eyes following a raised floor
const BOOM = 3;             // m: third person, camera to head
const CAMERA_CLEARANCE = 0.1; // m: the third-person camera from the floor and the ceiling
const BOOM_EASE = 12;       // 1/s: the camera pulled in by a wall comes back smoothly
const AVATAR_COLOR = '#ff9a1a'; // without a room (no presence color)
const AVATAR_HIDE_BOOM = 0.9; // m: a camera pulled closer by a wall would sit inside the avatar: hidden

const KEYS = {
    KeyW: [0, 1], ArrowUp: [0, 1],
    KeyS: [0, -1], ArrowDown: [0, -1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0]
};
const isTyping = (target) => target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
const noRaycast = () => null;

/*
* WALK (Tour, flatscreen; Scene.jsx mounts it instead of CameraControls when tourView is 'first' or 'third',
* workspaceSlice.js). WASD / arrows walk (Shift runs), left button held + drag turns the head; touch: one finger
* drags the view, the virtual joystick (ui/walk-joystick/WalkJoystick.jsx, walkInput) walks.
* Eyes EYE_HEIGHT above the floor under them (raised floors: eased), never through walls nor closed doors
* (walk.js: open doors and passages let you through), sliding along what stops you.
* view 'first': the camera is the eyes. 'third': a simple avatar (capsule + head, this device's presence color)
*   stands there and the camera sits BOOM behind its head along the view, pulled in by the walls behind
*   and the ceiling / roof unless hidden on this device (walk.js boomLength; closer than AVATAR_HIDE_BOOM the avatar hides). Switching between the two keeps the place.
* Start: where the orbit camera stands if that is walkable, else the floor point at the center of the view,
*   else the middle of the plan; then the closest place to stand (walk.js standingPoint), looking the same way.
*   The orbit view comes back as it was (CameraMemory saved it when CameraControls unmounted).
* Clicks still reach the scene (doors, moving parts, product card, notes, ruler): a drag never clicks.
* ponytail: the placeable player start (plan step 3) will decide the start.
*/
export default function WalkControls({ view }) {
    const getThree = useThree((state) => state.get); // the camera is three's object, changed in place
    const gl = useThree((state) => state.gl);
    const invalidate = useThree((state) => state.invalidate);
    const pose = useRef(null);     // { x, z, y, yaw, pitch, yawGoal, pitchGoal, boom } (goal = dragged, yaw / pitch = shown)
    const speed = useRef([0, 0]);  // current [right, forward] in m/s
    const keys = useRef(new Set());
    const run = useRef(false);
    const avatarRef = useRef();
    const color = useSelfColor() ?? AVATAR_COLOR;

    // start pose, from the orbit camera
    useEffect(() => {
        const { camera } = getThree();
        const { plan, openDoors } = useStore.getState();
        const level = activeLevel(plan);
        const direction = camera.getWorldDirection(new Vector3());
        // where the view meets the floor (y = 0), when it looks down
        const hit = direction.y < -0.05 ? camera.position.clone().addScaledVector(direction, -camera.position.y / direction.y) : null;
        const candidates = [[camera.position.x, camera.position.z], hit && [hit.x, hit.z], levelBounds(level).center].filter(Boolean);
        const near = candidates.find((point) => standingPoint(level, point, openDoors) === point) ?? standingPoint(level, candidates.at(-1), openDoors);
        pose.current = { x: near[0], z: near[1], y: eyeHeight(level, near), yaw: Math.atan2(-direction.x, -direction.z), pitch: 0, boom: BOOM };
        pose.current.yawGoal = pose.current.yaw;
        pose.current.pitchGoal = 0;
        camera.rotation.order = 'YXZ';
        invalidate();
        return () => { camera.rotation.order = 'XYZ'; };
    }, [getThree, invalidate]);

    // keyboard
    useEffect(() => {
        const down = (event) => {
            run.current = event.shiftKey;
            if (!(event.code in KEYS) || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
            keys.current.add(event.code);
            event.preventDefault(); // arrows must not scroll a panel
            wakeRender();
        };
        const up = (event) => {
            run.current = event.shiftKey;
            keys.current.delete(event.code);
        };
        const clear = () => keys.current.clear(); // released while the window had no focus
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', clear);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('blur', clear);
        };
    }, []);

    // look: left button (or one finger) held on the canvas and dragged
    useEffect(() => {
        const canvas = gl.domElement;
        let dragging = null; // { id, x, y, k }
        const start = (event) => {
            if (dragging != null || (event.pointerType === 'mouse' && event.button !== 0)) return;
            dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, k: event.pointerType === 'mouse' ? LOOK_SPEED : TOUCH_LOOK_SPEED };
        };
        const move = (event) => {
            if (dragging?.id !== event.pointerId || pose.current == null) return;
            pose.current.yawGoal -= (event.clientX - dragging.x) * dragging.k;
            pose.current.pitchGoal += (event.clientY - dragging.y) * dragging.k; // drag down = look down
            dragging.x = event.clientX;
            dragging.y = event.clientY;
            invalidate();
        };
        const end = (event) => { if (dragging?.id === event.pointerId) dragging = null; };
        canvas.addEventListener('pointerdown', start);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        return () => {
            canvas.removeEventListener('pointerdown', start);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
        };
    }, [gl, invalidate]);

    useFrame(({ camera }, frameDelta) => {
        const p = pose.current;
        if (p == null) return;
        const delta = Math.min(frameDelta, 0.1);
        const state = useStore.getState();
        const level = activeLevel(state.plan);

        // input: keys + joystick, at most 1 in every direction
        let [right, forward] = [walkInput.x, walkInput.y];
        for (const code of keys.current) { right += KEYS[code][0]; forward += KEYS[code][1]; }
        const length = Math.hypot(right, forward);
        if (length > 1) { right /= length; forward /= length; }
        const top = WALK_SPEED * (run.current ? RUN_FACTOR : 1);
        const k = 1 - Math.exp(-delta * ACCELERATION);
        speed.current[0] += (right * top - speed.current[0]) * k;
        speed.current[1] += (forward * top - speed.current[1]) * k;
        const moving = Math.hypot(...speed.current) > 0.01;
        if (!moving && length === 0) speed.current = [0, 0];

        // the view eases towards the dragged direction
        const [up, down] = PITCH[view];
        p.pitchGoal = Math.max(up, Math.min(down, p.pitchGoal));
        const look = 1 - Math.exp(-delta * LOOK_EASE);
        p.yaw += (p.yawGoal - p.yaw) * look;
        p.pitch += (p.pitchGoal - p.pitch) * look;
        const turning = Math.abs(p.yawGoal - p.yaw) > 1e-4 || Math.abs(p.pitchGoal - p.pitch) > 1e-4;
        if (!turning) { p.yaw = p.yawGoal; p.pitch = p.pitchGoal; }

        const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
        if (moving) {
            const [r, f] = [speed.current[0] * delta, speed.current[1] * delta];
            // forward = -Z turned by yaw, right = +X turned by yaw
            [p.x, p.z] = walkStep(level, [p.x, p.z], [r * cos - f * sin, -r * sin - f * cos], state.openDoors);
        }
        const eyes = eyeHeight(level, [p.x, p.z]);
        p.y += (eyes - p.y) * (1 - Math.exp(-delta * HEIGHT_EASE));
        let settling = Math.abs(eyes - p.y) > 0.001;
        if (!settling) p.y = eyes;

        camera.rotation.set(-p.pitch, p.yaw, 0);
        if (view === 'first') {
            camera.position.set(p.x, p.y, p.z);
        } else {
            // behind the head along the view: back = -(view direction), limited by the walls and the roof
            const cosPitch = Math.cos(p.pitch);
            const back = [sin * cosPitch, Math.sin(p.pitch), cos * cosPitch];
            // ceilings hidden on this device (Hide ceiling, workspaceSlice.js ceilingVisible): only the walls stop it
            const goal = boomLength(level, [p.x, p.y, p.z], back, BOOM, state.openDoors, state.ceilingVisible);
            p.boom = goal < p.boom ? goal : p.boom + (goal - p.boom) * (1 - Math.exp(-delta * BOOM_EASE)); // in at once, out smoothly
            if (Math.abs(goal - p.boom) > 0.001) settling = true;
            const floor = groundHeight(level, [p.x, p.z]);
            const at = [p.x + back[0] * p.boom, p.z + back[2] * p.boom];
            // never under the floor nor over the ceiling there (BOOM_MIN close to a low roof)
            const y = Math.min((state.ceilingVisible ? ceilingAt(level, at) : Infinity) - CAMERA_CLEARANCE, Math.max(floor + CAMERA_CLEARANCE, p.y + back[1] * p.boom));
            camera.position.set(at[0], y, at[1]);
            avatarRef.current?.position.set(p.x, floor, p.z);
            avatarRef.current?.rotation.set(0, p.yaw, 0);
            if (avatarRef.current) avatarRef.current.visible = p.boom > AVATAR_HIDE_BOOM;
        }
        camera.updateMatrixWorld();
        // on-demand rendering (FrameDriver.jsx): keep frames coming while walking or settling
        if (moving || length > 0 || settling || turning) wakeRender();
    });

    if (view !== 'third') return null;
    // never hit by pointers, rulers or drops (raycast off): it only shows where you stand
    return (
        <group ref={avatarRef}>
            <mesh position={[0, 0.85, 0]} raycast={noRaycast} castShadow>
                <capsuleGeometry args={[0.2, 0.9, 6, 16]} />
                <meshStandardMaterial color={color} roughness={0.6} />
            </mesh>
            <mesh position={[0, EYE_HEIGHT - 0.05, 0]} raycast={noRaycast} castShadow>
                <sphereGeometry args={[0.13, 20, 14]} />
                <meshStandardMaterial color={color} roughness={0.6} />
            </mesh>
            {/* the nose: which way it faces */}
            <mesh position={[0, EYE_HEIGHT - 0.05, -0.13]} raycast={noRaycast}>
                <boxGeometry args={[0.06, 0.04, 0.08]} />
                <meshStandardMaterial color="#222" />
            </mesh>
        </group>
    );
}
