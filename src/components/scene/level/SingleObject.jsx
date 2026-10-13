import { PivotControls } from "../controls/pivot-controls";
import SelectionOutline from "../helpers/SelectionOutline";
import DragFootprint from "../helpers/DragFootprint";
import { isRayPointer, keepOverSurface, startSurfaceDrag, updateSurfaceDrag } from "../controls/surfaceDrag";
import * as THREE from 'three'
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { useHandle } from "@react-three/handle";
import { useStore } from "../../../store/appStore";

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

// Grid snap cell (board meters: real meters in the room and in the tabletop model)
const GRID_SNAP_STEP = 0.1;

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

// Handle rotate option for each pointer rotation mode (near grabs; ray drags use surfaceDrag.js)
const HANDLE_ROTATE = { none: false, free: true, yaw: { x: false, y: true, z: false } };

/*
* A placed object. Hierarchy (kept stable, so drags never remount the mesh):
*
*   group (targetRef)  <- owns the transform saved in the store; moved by grab/drag
*   └─ PivotControls   <- flatscreen gizmo; its inner matrix is a delta, reset to identity on commit
*      └─ mesh (meshRef) <- click to select, press + drag (mouse) / grip (controller) / pinch (hand) to grab
*/
export default function SingleObject({ data, showPivot, pointerRotation }) {

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

    // true while the object itself is grabbed: the gizmo is hidden and comes back on release
    const [isGrabbing, setIsGrabbing] = useState(false);
    // Active surface drag (mouse / controller ray / hand ray), null for near grabs (see surfaceDrag.js)
    const surfaceDragRef = useRef(null);
    // Last pointer event of the current drag, re-used on frames without pointer movement
    const lastEventRef = useRef(null);

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
        mesh.addEventListener('pointerdown', lock);
        mesh.addEventListener('pointerup', unlock);
        mesh.addEventListener('pointercancel', unlock);
        return () => {
            mesh.removeEventListener('pointerdown', lock);
            mesh.removeEventListener('pointerup', unlock);
            mesh.removeEventListener('pointercancel', unlock);
        };
    }, [getThree]);

    // GRAB: free movement with mouse/controller/hand. pointerRotation: 'free' (XR 1:1) follows the
    // controller/hand rotation, 'yaw' (tabletop) keeps pieces upright, 'none' (flatscreen: a mouse ray would spin it).
    // - Ray pointers (mouse, controller ray, hand-ray pinch): surfaceDrag.js — the object slides over the
    //   surfaces under the ray (floor, walls, ceiling, other objects), always upright.
    // - Near pointers (grip/pinch touching the object): rigid attachment computed by Handle.
    useHandle(targetRef, {
        handle: meshRef,
        translate: true,
        rotate: HANDLE_ROTATE[pointerRotation],
        scale: false,
        multitouch: false,
        // apply() every frame while held, even with a still pointer: surface snap dwell times and
        // smoothing must keep progressing (see surfaceDrag.js)
        alwaysUpdate: true,
        apply: (state, target) => {
            if (state.first) {
                selectObject(data.id);
                setGrabbedObject(data.id);
                setIsGrabbing(true);
                // read at grab time only (no re-render of every object when the setting changes)
                const gridStep = useStore.getState().settings.gridSnap ? GRID_SNAP_STEP : 0;
                surfaceDragRef.current = isRayPointer(state.event)
                    ? startSurfaceDrag(state.event, target, meshRef.current, { gridStep })
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
                keepOverSurface(target, meshRef.current, _previous); // room bounds (ray drags do it inside)
            }
            clampAboveFloor(target, meshRef.current); // live floor limit while dragging
            if (state.last) {
                surfaceDragRef.current = null;
                lastEventRef.current = null;
                setGrabbedObject(null);
                setIsGrabbing(false);
                commitTransform();
            }
        }
    });

    // GIZMO drag end: bake the gizmo delta into the target, reset the delta, then save
    const handlePivotDragEnd = () => {
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
                enabled={showPivot && isSelected && !isGrabbing}
                depthTest={false}
                scale={GIZMO_SCALE}
                anchor={[0, 0, 0]}
                onDragEnd={handlePivotDragEnd}
            >
                <mesh
                    ref={meshRef}
                    castShadow
                    receiveShadow
                    onClick={handleClick}
                >
                    {renderGeometry(data.geometryType)}
                    <meshStandardMaterial color={data.color} />
                    {/* red = the VR delete gesture is armed for this object */}
                    {isSelected && <SelectionOutline color={isDeleteArmed ? "red" : "orange"} thickness={2} />}
                </mesh>
            </PivotControls>
        </group>
        {/* where the object is / will land while it is moved (sibling: lives in board space) */}
        {isGrabbing && <DragFootprint targetRef={targetRef} bodyRef={meshRef} />}
        </>
    );
}
