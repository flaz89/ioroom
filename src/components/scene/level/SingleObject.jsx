import { PivotControls } from "../controls/pivot-controls";
import SelectionOutline from "../helpers/SelectionOutline";
import DragFootprint from "../helpers/DragFootprint";
import { isRayPointer, keepOverSurface, startSurfaceDrag, TWIST_TO_YAW, twistAngle, twistWithDeadzone, updateSurfaceDrag } from "../controls/surfaceDrag";
import * as THREE from 'three'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { endLivePose, holdObject, isLockedByOther, publishLivePose, releaseObject, remotePoses, useObjectLock, useSelfColor } from "../../../sync/presence";
import { useHandle } from "@react-three/handle";
import { useStore } from "../../../store/appStore";
import { NotePin } from "../notes/Notes";
import { meshSpherecast } from "../controls/meshSpherecast";
import { objectMeshes } from "./objectMeshes";
import { setCursorGrabbing, setCursorHover } from "../sceneCursor";

function renderGeometry(type) {
  switch(type) {
    case 'boxGeometry':
      return <boxGeometry />;
    case 'planeGeometry':
      return <planeGeometry />;
    case 'sphereGeometry':
      return <sphereGeometry />;
    case 'capsuleGeometry':
      return <capsuleGeometry />;
    case 'cylinderGeometry':
      return <cylinderGeometry />;
    case 'circleGeometry':
      return <circleGeometry />;
    case 'donutGeometry':
      return <torusGeometry />;
    case 'knotGeometry':
      return <torusKnotGeometry />;
    default:
      console.warn(`"${type}" geometry doesn't exist, boxGeometry used`);
      return <boxGeometry />;
  }
}

// Reused temporaries (avoid allocations during drags)
const _box = new THREE.Box3();
const _matrix = new THREE.Matrix4();
const _previous = new THREE.Vector3();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _startEuler = new THREE.Euler();
const _startQuaternion = new THREE.Quaternion();
const _startScale = new THREE.Vector3();

/*
* Snap steps for a drag that starts now: grid cell in board meters (real meters in the room and in
* the tabletop model) and rotation step in radians, 0 = that snap is off.
* Read from the store at drag start only, so changing the settings never re-renders every object.
*/
function currentSnapSteps() {
    const { gridSnap, gridSnapStep, rotationSnap, rotationSnapStep } = useStore.getState().settings;
    return {
        gridStep: gridSnap ? gridSnapStep / 100 : 0,
        yawStep: rotationSnap ? THREE.MathUtils.degToRad(rotationSnapStep) : 0
    };
}

const snapValue = (value, step) => Math.round(value / step) * step;

// Gizmo size (1 = drei default, in meters since the gizmo is not screen-fixed)
const GIZMO_SCALE = 2 / 3;

const _parentPosition = new THREE.Vector3();
const _parentScale = new THREE.Vector3();

/*
* Floor limit: lifts the object so its bounding box never goes below the floor of its parent
* (y = 0 of the board: the real floor at 1:1, the table surface in tabletop mode).
* Assumes the parent has yaw-only rotation and uniform scale (true for the board).
* body: the object whose bounds count (the mesh), so gizmo handles never affect the result.
*/
function clampAboveFloor(target, body) {
    target.updateMatrixWorld(true);
    _box.setFromObject(body);
    const parent = target.parent;
    const floorY = parent ? parent.getWorldPosition(_parentPosition).y : 0;
    if (_box.min.y >= floorY) return;
    const parentScale = parent ? parent.getWorldScale(_parentScale).y : 1;
    target.position.y += (floorY - _box.min.y) / parentScale; // world lift -> parent (local) units
}

// Handle rotate option for each pointer rotation mode (near grabs; ray drags use surfaceDrag.js).
// 'yaw' (tabletop): Handle does not rotate, the wrist twist turns the piece instead (see nearGrabYaw)
const HANDLE_ROTATE = { none: false, free: true, yaw: false };
const _up = new THREE.Vector3(0, 1, 0);
const _livePosition = new THREE.Vector3();
const _liveQuaternion = new THREE.Quaternion();
const _liveScale = new THREE.Vector3();
const _liveMatrix = new THREE.Matrix4();
const HOVER_TINT = 0.35;               // strength of the hover tint (emissive intensity)
const HOVER_FALLBACK_COLOR = '#ffffff'; // hover tint without a shared room
const REMOTE_FOLLOW_RATE = 20; // 1/s: how fast an object follows another device's drag (higher = snappier)
const _twist = new THREE.Quaternion();

/*
* Tabletop NEAR grab: yaw from the wrist twist around the grabbing hand's forward axis (same rule and
* dead zone as the controller rays in surfaceDrag.js), the piece stays upright. `grab` is captured at
* grab start: { reference (pointer quaternion^-1), axis (world forward), yaw (start yaw), yawStep }.
*/
function nearGrabYaw(grab, pointerQuaternion) {
    _twist.multiplyQuaternions(pointerQuaternion, grab.reference);
    const yaw = grab.yaw - TWIST_TO_YAW * twistWithDeadzone(twistAngle(_twist, grab.axis));
    return grab.yawStep > 0 ? Math.round(yaw / grab.yawStep) * grab.yawStep : yaw;
}

/*
* A placed object. Hierarchy (kept stable, so drags never remount the mesh):
*
*   group (targetRef)  <- owns the transform saved in the store; moved by grab/drag
*   └─ PivotControls   <- flatscreen gizmo; its inner matrix is a delta, reset to identity on commit
*      ├─ mesh (meshRef) <- click to select, press + drag (mouse) / grip (controller) / pinch (hand) to grab
*      └─ NotePin...     <- post-it notes stuck on the object (object local space, see scene/notes/Notes.jsx)
*/
export default function SingleObject({ data, notes, showPivot, pointerRotation, nearGrabFootprint }) {

    const targetRef = useRef();
    const meshRef = useRef();
    const pivotRef = useRef(); // PivotControls inner group, its matrix holds the gizmo drag delta

    const getThree = useThree((state) => state.get);
    const selectObject = useStore((state) => state.selectObject);
    const selectedId = useStore((state) => state.objects.selectedId);
    const updateObject = useStore((state) => state.updateObject);
    const setGrabbedObject = useStore((state) => state.setGrabbedObject);
    const isSelected = data.id === selectedId;
    const isDeleteArmed = useStore((state) => state.objects.deleteArmed);
    // Shared rooms: color of the other device holding this object (locked here), null when free
    const lockColor = useObjectLock(data.id);
    // HOVER: a RAY pointer (mouse, controller/hand ray) is over the object -> tinted with this device's
    // presence color (the color others see for it; neutral white without a room). Never from near
    // pointers (grip/touch), never on the selected object or while it is held here, never on objects
    // locked by others.
    const [isHovered, setIsHovered] = useState(false);
    const hoverColor = useSelfColor() ?? HOVER_FALLBACK_COLOR;
    // true while a grab started on a locked object (or lost the tie): the grab does nothing until released
    const blockedGrabRef = useRef(false);

    // true while the object itself is grabbed: the gizmo is hidden and comes back on release
    // false, or how it is grabbed: 'ray' (mouse, controller/hand ray) / 'near' (grip or pinch touching it)
    const [isGrabbing, setIsGrabbing] = useState(false);
    // Active surface drag (mouse / controller ray / hand ray), null for near grabs (see surfaceDrag.js)
    const surfaceDragRef = useRef(null);
    // Tabletop near grab: wrist twist reference (see nearGrabYaw), null otherwise
    const nearGrabRef = useRef(null);
    // Last pointer event of the current drag, re-used on frames without pointer movement
    const lastEventRef = useRef(null);
    // true while the gizmo is dragged (shows the footprint)
    const [isGizmoDragging, setIsGizmoDragging] = useState(false);
    // Footprint inputs, read every frame: the current support (walls show the dots behind the object)
    const getSupportNormal = () => surfaceDragRef.current?.supportNormal ?? null;

    // Clamp to the floor and save the target transform as the single source of truth
    const commitTransform = () => {
        const target = targetRef.current;
        clampAboveFloor(target, meshRef.current);
        updateObject(data.id, {
            position: target.position.toArray(),
            rotation: [target.rotation.x, target.rotation.y, target.rotation.z],
            scale: target.scale.toArray()
        });
    };

    // CLICK on mesh
    const handleClick = (event) => {
        event.stopPropagation();
        if (useStore.getState().notes.placing) return; // the press sticks a post-it note (scene/notes/Notes.jsx)
        if (useStore.getState().measures.active) return; // the click places a ruler point (scene/measure/Measures.jsx)
        selectObject(data.id);
    };

    // OrbitControls listens to raw DOM events and would start orbiting on the same press that
    // starts a grab: lock it on press, unlock on release (also covers a click without drag).
    // Registered with addEventListener (not onPointerDown props) because pmndrs pointer events
    // ignore R3F prop handlers on objects that already have three.js listeners (Handle uses them),
    // and in a layout effect so they run before useHandle binds its own listeners.
    useLayoutEffect(() => {
        const mesh = meshRef.current;
        const setOrbitEnabled = (enabled) => {
            const controls = getThree().controls; // OrbitControls (makeDefault)
            if (controls) controls.enabled = enabled;
        };
        const lock = () => setOrbitEnabled(false);
        const unlock = () => setOrbitEnabled(true);
        // ray pointers only (mouse, controller/hand ray): a hand or controller touching the object never tints it
        const enter = (event) => { if (isRayPointer(event)) setIsHovered(true); };
        const leave = (event) => { if (isRayPointer(event)) setIsHovered(false); };
        mesh.addEventListener('pointerdown', lock);
        mesh.addEventListener('pointerup', unlock);
        mesh.addEventListener('pointercancel', unlock);
        mesh.addEventListener('pointerenter', enter);
        mesh.addEventListener('pointerleave', leave);
        return () => {
            mesh.removeEventListener('pointerdown', lock);
            mesh.removeEventListener('pointerup', unlock);
            mesh.removeEventListener('pointercancel', unlock);
            mesh.removeEventListener('pointerenter', enter);
            mesh.removeEventListener('pointerleave', leave);
        };
    }, [getThree]);

    // End of a grab: reset the drag state, release the lock, save the transform unless the grab was blocked
    const endGrab = (commit) => {
        surfaceDragRef.current = null;
        nearGrabRef.current = null;
        lastEventRef.current = null;
        setGrabbedObject(null);
        setIsGrabbing(false);
        releaseObject(data.id);
        if (commit) commitTransform();
    };

    // Back to the transform saved in the store (a blocked grab must leave no trace)
    const restoreSavedTransform = (target) => {
        target.position.fromArray(data.position);
        target.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
        target.scale.fromArray(data.scale);
    };

    // GRAB: free movement with mouse/controller/hand. pointerRotation: 'free' (XR 1:1) follows the
    // controller/hand rotation, 'yaw' (tabletop) keeps pieces upright, 'none' (flatscreen: a mouse ray would spin it).
    // - Ray pointers (mouse, controller ray, hand-ray pinch): surfaceDrag.js — the object slides over the
    //   surfaces under the ray (floor, walls, ceiling, other objects), always upright.
    // - Near pointers (grip/pinch touching the object): rigid attachment computed by Handle.
    useHandle(targetRef, {
        handle: meshRef,
        // post-it placing mode (scene/notes/Notes.jsx): the press sticks a note, it never grabs
        filter: () => !useStore.getState().notes.placing && !useStore.getState().measures.active,
        translate: true,
        rotate: HANDLE_ROTATE[pointerRotation],
        scale: false,
        multitouch: false,
        // apply() every frame while held, even with a still pointer: surface snap dwell times and
        // smoothing must keep progressing (see surfaceDrag.js)
        alwaysUpdate: true,
        apply: (state, target) => {
            // LOCK: held by another device (at press, or a simultaneous grab lost the tie): ignore this grab,
            // put the object back to its saved transform and never commit it
            if (blockedGrabRef.current || isLockedByOther(data.id)) {
                if (!blockedGrabRef.current && !state.first) {
                    // lost the tie mid-drag: stop owning and publishing, the winner's pose takes over
                    restoreSavedTransform(target);
                    releaseObject(data.id);
                    endLivePose(data.id);
                }
                blockedGrabRef.current = !state.last;
                if (state.last && !state.first) endGrab(false);
                return;
            }
            if (state.first) {
                holdObject(data.id);
                selectObject(data.id);
                setGrabbedObject(data.id);
                setIsGrabbing(isRayPointer(state.event) ? 'ray' : 'near');
                surfaceDragRef.current = isRayPointer(state.event)
                    ? startSurfaceDrag(state.event, target, meshRef.current, currentSnapSteps())
                    : null;
                const pointerQuaternion = state.event?.pointerQuaternion;
                nearGrabRef.current = !isRayPointer(state.event) && pointerRotation === 'yaw' && pointerQuaternion
                    ? {
                        reference: pointerQuaternion.clone().invert(),
                        axis: new THREE.Vector3(0, 0, -1).applyQuaternion(pointerQuaternion),
                        yaw: 2 * Math.atan2(target.quaternion.y, target.quaternion.w), // upright: exact (euler y is not past 90°)
                        yawStep: currentSnapSteps().yawStep
                    }
                    : null;
            }
            if (state.event) lastEventRef.current = state.event;
            if (surfaceDragRef.current) {
                // never on the press itself (a click to select must not move the object), then every frame
                const event = state.event ?? lastEventRef.current;
                if (event && !state.first && !state.last) {
                    updateSurfaceDrag(surfaceDragRef.current, event, target, meshRef.current, performance.now());
                }
            } else {
                _previous.copy(target.position);
                target.position.copy(state.current.position);
                target.quaternion.copy(state.current.quaternion);
                // tabletop: the wrist twist turns the piece (pointer quaternion of the last move event)
                const pointerQuaternion = (state.event ?? lastEventRef.current)?.pointerQuaternion;
                if (nearGrabRef.current && pointerQuaternion) {
                    target.quaternion.setFromAxisAngle(_up, nearGrabYaw(nearGrabRef.current, pointerQuaternion));
                }
                // room bounds (ray drags do it inside)
                keepOverSurface(target, meshRef.current, _previous);
            }
            clampAboveFloor(target, meshRef.current); // live floor limit while dragging
            if (state.last) endGrab(true);
        }
    });

    // Unmounted while held (deleted, room left): release the lock
    useEffect(() => () => releaseObject(data.id), [data.id]);
    // ruler measures anchored on this object follow its live mesh (objectMeshes.js)
    useEffect(() => {
        const mesh = meshRef.current;
        objectMeshes.set(data.id, mesh);
        return () => { if (objectMeshes.get(data.id) === mesh) objectMeshes.delete(data.id); };
    }, [data.id]);

    /*
    * LIVE SYNC (shared rooms, see sync/presence.js):
    * - while this device drags the object (grab or gizmo), its board-space pose is published every frame
    *   (gizmo: target x gizmo delta, the same pose committed on release);
    * - otherwise, while another device drags it, the object eases towards the received pose. On release
    *   the saved scene update sets the final transform through the data props.
    */
    const isDraggingHere = isGrabbing !== false || isGizmoDragging;

    // Mouse cursor (sceneCursor.js): hand while hovered, closed hand while this object is dragged here
    useEffect(() => {
        setCursorHover(data.id, isHovered);
        setCursorGrabbing(data.id, isDraggingHere);
    }, [data.id, isHovered, isDraggingHere]);
    useEffect(() => () => {
        setCursorHover(data.id, false);
        setCursorGrabbing(data.id, false);
    }, [data.id]);
    useFrame((_state, delta) => {
        const target = targetRef.current;
        if (target == null) return;
        if (isDraggingHere && !blockedGrabRef.current) {
            _liveMatrix.compose(target.position, target.quaternion, target.scale);
            if (pivotRef.current) _liveMatrix.multiply(pivotRef.current.matrix);
            _liveMatrix.decompose(_livePosition, _liveQuaternion, _liveScale);
            publishLivePose(data.id, _livePosition, _liveQuaternion, _liveScale);
            return;
        }
        const remote = remotePoses.get(data.id);
        if (remote == null) return;
        const follow = 1 - Math.exp(-delta * REMOTE_FOLLOW_RATE);
        target.position.lerp(_livePosition.fromArray(remote.p), follow);
        target.quaternion.slerp(_liveQuaternion.fromArray(remote.q), follow);
        target.scale.lerp(_liveScale.fromArray(remote.s), follow);
    });
    // Drag over on this device: stop sharing the live pose
    useEffect(() => {
        if (!isDraggingHere) endLivePose(data.id);
    }, [isDraggingHere, data.id]);

    // GIZMO drag start: footprint on, remember the snap step and the start pose (to snap only moved axes)
    const gizmoDragRef = useRef(null); // { gridStep, yawStep, start: Matrix4 } while the gizmo is dragged
    const handlePivotDragStart = () => {
        const target = targetRef.current;
        gizmoDragRef.current = {
            ...currentSnapSteps(),
            start: new THREE.Matrix4().compose(target.position, target.quaternion, target.scale)
        };
        setIsGizmoDragging(true);
        holdObject(data.id);
    };

    /*
    * GIZMO drag (every move, after PivotControls wrote its delta): grid snap. The full pose (target
    * x delta) is snapped in board space, only on the axes/angles this drag actually changed (an arrow
    * moves one axis, a plane two), then written back as a delta. PivotControls recomputes the delta
    * from the drag start every move, so snapping never accumulates.
    */
    const handlePivotDrag = () => {
        const target = targetRef.current;
        const pivot = pivotRef.current;
        const drag = gizmoDragRef.current;
        if (!target || !pivot || !drag || (!drag.gridStep && !drag.yawStep)) return;
        _matrix.compose(target.position, target.quaternion, target.scale).multiply(pivot.matrix);
        _matrix.decompose(_position, _quaternion, _scale);
        drag.start.decompose(_previous, _startQuaternion, _startScale);
        for (const axis of ['x', 'y', 'z']) {
            if (drag.gridStep && Math.abs(_position[axis] - _previous[axis]) > 1e-6) _position[axis] = snapValue(_position[axis], drag.gridStep);
        }
        _euler.setFromQuaternion(_quaternion);
        _startEuler.setFromQuaternion(_startQuaternion);
        for (const axis of ['x', 'y', 'z']) {
            if (drag.yawStep && Math.abs(_euler[axis] - _startEuler[axis]) > 1e-6) _euler[axis] = snapValue(_euler[axis], drag.yawStep);
        }
        _quaternion.setFromEuler(_euler);
        _matrix.compose(_position, _quaternion, _scale);
        // back to a delta relative to the target: delta = target^-1 x snapped pose
        pivot.matrix.compose(target.position, target.quaternion, target.scale).invert().multiply(_matrix);
    };

    // GIZMO drag end: bake the gizmo delta into the target, reset the delta, then save
    const handlePivotDragEnd = () => {
        gizmoDragRef.current = null;
        setIsGizmoDragging(false);
        releaseObject(data.id);
        const target = targetRef.current;
        const pivot = pivotRef.current;
        if (!target || !pivot) return;
        _matrix.compose(target.position, target.quaternion, target.scale).multiply(pivot.matrix);
        _matrix.decompose(target.position, target.quaternion, target.scale);
        pivot.matrix.identity();
        // room bounds: a gizmo drag that ends outside the surfaces goes back to the saved position
        keepOverSurface(target, meshRef.current, _previous.fromArray(data.position));
        commitTransform();
    };

    // Identity delta for the gizmo; PivotControls mutates it in place while dragging
    const pivotMatrix = useMemo(() => new THREE.Matrix4(), []);

    return (
        <>
        <group
            ref={targetRef}
            position={data.position}
            rotation={data.rotation}
            scale={data.scale}
        >
            <PivotControls
                ref={pivotRef}
                matrix={pivotMatrix}
                enabled={showPivot && isSelected && !isGrabbing && lockColor == null}
                depthTest={false}
                scale={GIZMO_SCALE}
                anchor={[0, 0, 0]}
                onDragStart={handlePivotDragStart}
                onDrag={handlePivotDrag}
                onDragEnd={handlePivotDragEnd}
            >
                <mesh
                    ref={meshRef}
                    userData={{ objectId: data.id }} // post-it placing: which object a note sticks on
                    // XR touch/grab: distance to the real surface, not the bounding box (notes on curved objects)
                    spherecast={meshSpherecast}
                    castShadow
                    receiveShadow
                    onClick={handleClick}
                >
                    {renderGeometry(data.geometryType)}
                    {/* hover overlay: emissive tint, so it shows on any base color and in any lighting */}
                    <meshStandardMaterial
                        color={data.color}
                        emissive={isHovered && !isSelected && isGrabbing === false && !isGizmoDragging && lockColor == null ? hoverColor : '#000000'}
                        emissiveIntensity={HOVER_TINT}
                    />
                    {/* locked by another device: its color; else selected: orange, red = VR delete gesture armed */}
                    {lockColor != null
                        ? <SelectionOutline color={lockColor} thickness={3} />
                        : isSelected && <SelectionOutline color={isDeleteArmed ? "red" : "orange"} thickness={2} />}
                </mesh>
                {notes.map((note) => <NotePin key={note.id} note={note} objectScale={data.scale} />)}
            </PivotControls>
        </group>
        {/* where the object is / will land while it is moved (sibling: lives in board space) */}
        {(isGizmoDragging || isGrabbing === 'ray' || (isGrabbing === 'near' && nearGrabFootprint)) && (
            <DragFootprint
                targetRef={targetRef}
                bodyRef={meshRef}
                getSupportNormal={getSupportNormal}
            />
        )}
        </>
    );
}
