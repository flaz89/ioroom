import { useEffect, useRef } from 'react';
import { BackSide, Color, Matrix4, Vector3 } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useXRInputSourceState } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { activeLevel } from '../../../plan/planModel';
import { canLand, isTeleportPose, teleportArc, teleportOffset } from './teleport';
import { measureHandPose } from './handPose';

/*
* TELEPORT with the LEFT hand (hand tracking), VR life mode only (mounted by Level.jsx; never in tabletop,
* where the left pinch is half of the two-hand zoom, nor in AR). Hold a thumb-index pinch: a dotted arc from
* the hand (orange, red where you cannot stand: teleport.js canLand) with a ring where it lands; release on
* a valid place: a short fade to black, the player moves there (head above the ring), fade back.
* - Only in the TELEPORT POSE (teleport.js isTeleportPose): hand raised in front, back of the hand towards
*   the user. A pinch with the arm hanging along the body (still seen by the cameras) used to teleport.
*   Leaving the pose while aiming cancels (no move).
* - In life mode the left hand has no pointers (ray, grab, touch: xrStore.js): it only teleports.
* - Only with every VR panel closed (isAnyPanelOpen: wrist menu, sun, materials, measure, note + keyboard),
*   and not while the fist delete gesture is armed.
* - The move: the XR reference space is replaced by an OFFSET space of the session's base space
*   (gl.xr.setReferenceSpace), so the camera, hands, pmndrs pointers and every pose this app reads with
*   gl.xr.getReferenceSpace() (avatars, notes, ruler, gestures) follow, untouched. three.js drops the custom
*   space on a new session, and so does this (base and offset kept per session).
*/
const PINCH_START = 0.015; // meters between thumb and index tips: pinch on (tune on the headset)
const PINCH_END = 0.03;    // ...and off
const DOT_EVERY = 3;       // arc samples per dot (teleport.js ARC_STEP: 1/60 s)
const MAX_DOTS = 64;
const DOT_RADIUS = 0.012;
const FADE_OUT = 0.1;      // s to black, then the move
const FADE_IN = 0.2;       // s back
const ORANGE = new Color('#ff9a1a');
const RED = new Color('#ff3c3c');

const _thumb = new Vector3();
const _index = new Vector3();
const _matrix = new Matrix4();
const _dir = new Vector3();
const _eyes = new Vector3();

/*
* Any VR panel on screen: teleport only works with all of them closed (pinching at a panel must never move
* the player). Wrist menu (with its catalog and stats panels), the room panels opened from it (VR_PANELS:
* openPanel values that have a VR panel, Level.jsx), the selected measure's panel (VRMeasurePanel) and the
* note panel (VRNotePanel, which also holds the Quest system keyboard). Flatscreen panels (settings, share,
* environments...) left open before entering VR are not shown in VR and do not count. A new VR panel must
* be added here.
*/
const VR_PANELS = ['sun', 'materials'];
const isAnyPanelOpen = (state) => state.view.handMenuVisible || VR_PANELS.includes(state.openPanel)
    || state.measures.selectedId != null || state.notes.draft != null || state.notes.openId != null;

export default function TeleportGesture() {
    const hand = useXRInputSourceState('hand', 'left');
    const gl = useThree((state) => state.gl);
    const dotsRef = useRef();
    const ringRef = useRef();
    const fadeRef = useRef();
    // aim: { landing: [x, z] | null, valid, head: [x, z] } while pinching; move: per session base / offset
    const aimRef = useRef(null);
    const moveRef = useRef({ session: null, base: null, offset: [0, 0] });
    const fadeStateRef = useRef(null); // { t, target } while fading
    const inPoseRef = useRef(false); // hysteresis state of isTeleportPose

    useEffect(() => () => { aimRef.current = null; }, []);

    // the reference space moved so that the head's ground point is on `target` ([x, z], world)
    const teleport = (head, target) => {
        const session = gl.xr.getSession();
        const move = moveRef.current;
        if (move.session !== session) Object.assign(move, { session, base: gl.xr.getReferenceSpace(), offset: [0, 0] });
        move.offset = teleportOffset(move.offset, head, target);
        gl.xr.setReferenceSpace(move.base.getOffsetReferenceSpace(new XRRigidTransform({ x: move.offset[0], y: 0, z: move.offset[1] })));
    };

    useFrame((_state, delta, frame) => {
        const dots = dotsRef.current, ring = ringRef.current, fade = fadeRef.current;
        if (dots == null || frame == null) return;
        const space = gl.xr.getReferenceSpace();
        const viewer = frame.getViewerPose(space)?.transform.position;

        // fade: out, move at black, back in
        const fading = fadeStateRef.current;
        if (fading) {
            fading.t += delta;
            if (viewer) fade.position.set(viewer.x, viewer.y, viewer.z);
            if (fading.target && fading.t >= FADE_OUT) {
                teleport(fading.head, fading.target);
                Object.assign(fading, { target: null, t: 0 });
            }
            fade.material.opacity = fading.target ? Math.min(fading.t / FADE_OUT, 1) : Math.max(1 - fading.t / FADE_IN, 0);
            fade.visible = fade.material.opacity > 0;
            if (!fading.target && fading.t >= FADE_IN) fadeStateRef.current = null;
        }

        const joints = hand?.inputSource.hand;
        const thumb = joints && frame.getJointPose?.(joints.get('thumb-tip'), space);
        const index = joints && frame.getJointPose?.(joints.get('index-finger-tip'), space);
        const aimPose = hand && frame.getPose(hand.inputSource.targetRaySpace, space);
        const state = useStore.getState();
        const blocked = isAnyPanelOpen(state) || state.objects.deleteArmed || fadeStateRef.current != null;
        const distance = thumb && index ? _thumb.copy(thumb.transform.position).distanceTo(_index.copy(index.transform.position)) : null;
        const handPose = joints && viewer && measureHandPose(frame, joints, space, _eyes.set(viewer.x, viewer.y, viewer.z));
        inPoseRef.current = handPose != null && isTeleportPose(handPose.drop, handPose.backToUser, inPoseRef.current);
        const aim = aimRef.current;
        const pinching = distance != null && distance < (aim ? PINCH_END : PINCH_START);

        if (aim && (!pinching || !inPoseRef.current)) {
            // released: go. Out of the pose while aiming, or tracking lost (distance null): cancel, no move
            if (!pinching && distance != null && aim.valid && !blocked) fadeStateRef.current = { t: 0, head: aim.head, target: aim.landing };
            aimRef.current = null;
        } else if (pinching && aimPose && viewer && inPoseRef.current && (aim || !blocked)) {
            const p = aimPose.transform.position;
            _dir.set(0, 0, -1).applyQuaternion(aimPose.transform.orientation);
            const { points, landing } = teleportArc([p.x, p.y, p.z], [_dir.x, _dir.y, _dir.z]);
            const valid = landing != null && canLand(activeLevel(state.plan), landing);
            aimRef.current = { landing, valid, head: [viewer.x, viewer.z] };
            const color = valid ? ORANGE : RED;
            let count = 0;
            for (let i = DOT_EVERY; i < points.length && count < MAX_DOTS; i += DOT_EVERY, count++) {
                dots.setMatrixAt(count, _matrix.makeTranslation(...points[i]));
            }
            dots.count = count;
            dots.instanceMatrix.needsUpdate = true;
            dots.material.color.copy(color);
            ring.visible = landing != null;
            if (landing) ring.position.set(landing[0], 0.01, landing[1]);
            ring.material.color.copy(color);
            dots.visible = true;
            return;
        }
        if (!aimRef.current) { dots.visible = false; ring.visible = false; }
    });

    return (
        <group pointerEvents="none">
            <instancedMesh ref={dotsRef} args={[undefined, undefined, MAX_DOTS]} visible={false} frustumCulled={false}>
                <sphereGeometry args={[DOT_RADIUS, 8, 6]} />
                <meshBasicMaterial toneMapped={false} />
            </instancedMesh>
            <mesh ref={ringRef} rotation-x={-Math.PI / 2} visible={false}>
                <ringGeometry args={[0.16, 0.2, 40]} />
                <meshBasicMaterial toneMapped={false} transparent opacity={0.9} depthWrite={false} />
            </mesh>
            {/* fade: a black sphere around the head, drawn over everything */}
            <mesh ref={fadeRef} visible={false} renderOrder={1000}>
                <sphereGeometry args={[0.3, 16, 12]} />
                <meshBasicMaterial color="black" side={BackSide} transparent opacity={0} depthTest={false} depthWrite={false} />
            </mesh>
        </group>
    );
}
