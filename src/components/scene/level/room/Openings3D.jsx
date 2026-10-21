import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BoxGeometry, BufferGeometry, DoubleSide, Float32BufferAttribute, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshStandardMaterial, Plane, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { activeLevel, faceOffsets, openingClearances, openingRects, resizeOpening, wallFrame } from '../../../../plan/planModel';
import { Html } from '@react-three/drei';
import { setCursorHover } from '../../sceneCursor';
import { isStillClick } from './builderClick';
import { getPointerRay } from '../../controls/pointerRay';
import { useStore } from '../../../../store/appStore';
import { openingParts } from './doorModel';

/*
* DOORS AND WINDOWS in 3D (hinged, sliding on a face, pocket; fixed windows): frame, leaves (a window's: sash +
* glass) and handles of every opening of the level, built from the plan (doorModel.js openingParts, the rules
* shared with the 2D symbol); a door 'passage' / window 'hole' is only the wall's hole. Mounted by Room.jsx.
* "Door" below means any opening with parts.
* - One group per door on the wall's drawn line: local x = the wall's direction, y = up, z = -normal (so
*   the model's c axis is -z), placed at the wall's start `a`. The frame is one merged mesh; each leaf (with
*   its handle) sits in a PIVOT group on its hinge axis: open = turned by openAngle (hinged) or moved along
*   the wall by openShift (sliding, pocket; doorModel.js).
* - OPEN / CLOSED (store openDoors: shared, not in the undo history): each leaf's PROGRESS (0 closed .. 1 open)
*   eases towards its target every frame (OPEN_SPEED), on every device, so a change made anywhere is seen
*   opening; rotation = progress x openAngle, x = hinge + progress x openShift. The progress lives in a map
*   by leaf (`<opening>:<index>`) that outlives the geometry rebuilt on each plan change; a leaf seen for the
*   first time (page load, a new door) starts at its target, without animating.
* - Parts are named for the material step: surface ids '<opening>:frame' | ':leaf' | ':handle' (userData),
*   like the walls' faces. Plain materials for now (FRAME / LEAF / HANDLE colors).
* - Not pickable yet (raycast off): clicks and drags go through to the walls and the floor as before; the
*   VR open / close interaction comes later.
* - BUILDER (3D view): every opening, door or window, has an invisible PICK BOX filling its reveal (a window
*   is only a hole: nothing else to click). Click = select it (store selectedOpening, shared with the 2D plan:
*   WallPanel.jsx shows its panel), hand cursor over it. TINTS like the walls (SurfaceMesh.jsx): the door
*   under the mouse glows lightly orange, the selected one stronger, frame + leaves + handles; a window (no
*   parts yet) shows its pick box tinted instead, lighter on hover. Same click rules as
*   the walls (builderClick.js: not after an orbit drag, not while the ruler / post-it tool owns the click).
* - RESIZE HANDLES (builder, the selected opening): a flat orange triangle at each end of its BOTTOM edge
*   (floor for a door, sill for a window), on the wall's axis, pointing out along the wall, drawn over
*   everything (at that height they sit inside the wall). Drag = that edge follows the pointer along the
*   wall (the pointer's ray on the horizontal plane of the handles: controls/pointerRay.js, since pmndrs'
*   event.ray of a mouse does not follow the cursor), with the 2D rules (planModel.resizeOpening: grid
*   snap, stops at the neighbour / wall end, at least 30 cm). The room shows a LOCAL preview while dragging
*   (store levelPreview, Room.jsx), committed on release: one undo step, nothing sent to the room before.
* - DIMENSIONS (with the handles, live while dragging), styled like the 2D plan's lengths (plain text with a
*   dark halo, constant size on screen: HTML labels, class plan-length-3d; the 3D builder is flatscreen only),
*   just off the wall's inner face (the room's side):
*   - horizontal: from each edge to the nearest element on that side (planModel.openingClearances, the 2D
*     rule), in the middle of the gap, at the bottom edge's height;
*   - vertical, on the opening's center line: ABOVE, from its head to the wall's top (every opening); BELOW,
*     from the floor to the sill (windows only: a door stands on the floor).
*   Each has a thin dimension LINE with end ticks (drawn over everything), the value at its middle.
*   Handles and dimensions only in the 3D view: with the 2D plan open the scene is under it, and the HTML
*   labels would float over the plan.
* - DESIGNER (flatscreen and XR): the door's parts are pickable (frame, leaves, handles: real surfaces, so
*   the ruler and post-its can use them too; userData.noPlacement keeps furniture off them, surfaceDrag.js).
*   A CLICK on a door toggles it open / closed (store openDoors), with the mouse, a controller / hand ray or a
*   fingertip touch; hand cursor and a light orange tint on mouse hover. Not after an orbit drag, not while
*   the ruler / post-it tool owns the click.
* ponytail: one mesh per leaf and per handle (a house has tens of doors); instance or merge if it shows in perf.
*/
const FRAME_COLOR = '#f1eee8';
const LEAF_COLOR = '#e6e0d4';
const HANDLE_COLOR = '#a9adb2';

// Part materials, shared by every door, per tint (false | 'hover' | true = selected): the walls' emissive
// orange and strengths (SurfaceMesh.jsx). Never disposed: module lifetime, like SurfaceMesh's cache.
// Handle: satin steel (a high metalness looks black without an environment map to reflect).
const TINT = '#ff9a1a';
const TINT_STRENGTH = { hover: 0.08, selected: 0.18 };
const PARTS = {
    frame: { color: FRAME_COLOR, roughness: 0.6 },
    leaf: { color: LEAF_COLOR, roughness: 0.55 },
    handle: { color: HANDLE_COLOR, roughness: 0.35, metalness: 0.4 },
    // window pane: see-through, never hides what is behind it in the depth buffer
    glass: { color: '#cfe3ee', roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false }
};
const partMaterials = new Map();
function partMaterial(part, tinted) {
    const key = `${part}|${tinted}`;
    if (!partMaterials.has(key)) {
        const glow = tinted ? { emissive: TINT, emissiveIntensity: tinted === 'hover' ? TINT_STRENGTH.hover : TINT_STRENGTH.selected } : {};
        partMaterials.set(key, new MeshStandardMaterial({ ...PARTS[part], ...glow }));
    }
    return partMaterials.get(key);
}
const noRaycast = () => null;
const PICK_OUTSET = 0.002; // m: the pick box pokes out of the wall faces (its tint never z-fights the leaf)
// pick box: invisible but raycast (drawn with no color / depth); a window's box shows when hovered / selected
const pickMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false });
const pickTint = (opacity) => new MeshBasicMaterial({ color: TINT, transparent: true, opacity, depthWrite: false, toneMapped: false });
const pickHoverMaterial = pickTint(0.12);
const pickSelectedMaterial = pickTint(0.28);
const OPEN_SPEED = 5;   // 1/s: exponential easing rate (about 0.6 s to open); tune by eye
const SETTLED = 1e-4;   // progress: close enough to the target to stop

// Boxes (doorModel frame: x along, y up, c across) as one geometry in the door group's frame (z = -c),
// shifted by `origin` ([x, c]: a leaf's hinge, so the pivot group sits there)
function boxesGeometry(boxes, origin = [0, 0]) {
    const pieces = boxes.map(({ min, max }) => new BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2])
        .translate((min[0] + max[0]) / 2 - origin[0], (min[1] + max[1]) / 2, -((min[2] + max[2]) / 2 - origin[1])));
    const merged = mergeGeometries(pieces);
    pieces.forEach((piece) => piece.dispose());
    return merged;
}

// Resize handles: a triangle with its base on the edge and its tip HANDLE_LENGTH out along +x (meters)
const HANDLE_LENGTH = 0.14;
const HANDLE_HALF_WIDTH = 0.08;
const HANDLE_LIFT = 0.004; // above the bottom edge (no flicker with the floor / sill)
const triangle = (() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, -HANDLE_HALF_WIDTH, HANDLE_LENGTH, 0, 0, 0, 0, HANDLE_HALF_WIDTH], 3));
    geometry.computeVertexNormals();
    return geometry;
})();
const handleMaterial = (color) => new MeshBasicMaterial({ color, side: DoubleSide, depthTest: false, depthWrite: false, toneMapped: false });
const edgeMaterial = handleMaterial(TINT);
const edgeHoverMaterial = handleMaterial('#ffffff');
const UP = new Vector3(0, 1, 0);
const GAP_FACE_OFFSET = 0.01; // m: the distance dimensions sit this far off the inner face, into the room
const GAP_MIN = 0.005;        // m: shorter gaps get no dimension (an opening against its neighbour)
const TICK = 0.04;            // m: half length of a dimension line's end ticks
const dimensionMaterial = new LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false });

const _plane = new Plane();
const _hit = new Vector3();


// Group placement of a wall's openings: at its start, local +x along its direction
const wallPlacement = (wall) => {
    const { dir } = wallFrame(wall);
    return { position: [wall.a[0], 0, wall.a[1]], rotationY: Math.atan2(-dir[1], dir[0]) };
};

// Builder pick boxes, one per opening (doors and windows): its reveal, a hair beyond the faces
function buildPickBoxes(level) {
    return level.walls.flatMap((wall) => {
        const { inner, outer } = faceOffsets(wall);
        const c0 = Math.min(inner, outer) - PICK_OUTSET, c1 = Math.max(inner, outer) + PICK_OUTSET;
        return openingRects(wall, wall.height ?? level.wallHeight).map((rect) => ({
            key: rect.opening.id,
            isDoor: openingParts(wall, rect.opening, wall.height ?? level.wallHeight) != null, // has 3D parts to tint
            wallId: wall.id,
            openingId: rect.opening.id,
            ...wallPlacement(wall),
            geometry: boxesGeometry([{ min: [rect.from, rect.bottom, c0], max: [rect.to, rect.top, c1] }])
        }));
    });
}

// Builder: a click on an opening's pick box selects it (not after an orbit drag, not under the ruler / post-its)
function onPickClick(event, wallId, openingId) {
    const state = useStore.getState();
    if (state.workspace !== 'builder' || state.measures.active || state.notes.placing || !isStillClick(event)) return;
    event.stopPropagation();
    state.setSelectedOpening({ wallId, openingId });
}
// mouse over / out of a pick box: hand cursor, and the hovered opening (tint)
const onPickHover = (event, openingId, setHoveredId) => {
    if (event.nativeEvent?.pointerType !== 'mouse') return;
    setCursorHover('builder-opening', openingId != null);
    setHoveredId(openingId);
};

const DOOR_USER_DATA = (id, part) => ({ surfaceId: `${id}:${part}`, noPlacement: true });

// Designer: a click on a door part opens / closes it (not after an orbit drag, not under the ruler / post-its)
function onDoorClick(event, doorId) {
    const state = useStore.getState();
    if (state.workspace !== 'designer' || state.measures.active || state.notes.placing || !isStillClick(event)) return;
    event.stopPropagation();
    state.setDoorOpen(doorId, !state.openDoors[doorId]);
}

// Every swing door of the level as { key, position, rotationY, frame, leaves: [{ hinge, leaf, handle }] }
function buildDoors(level) {
    const doors = [];
    for (const wall of level.walls) {
        const height = wall.height ?? level.wallHeight;
        for (const opening of wall.openings ?? []) {
            const parts = openingParts(wall, opening, height);
            if (parts == null) continue;
            doors.push({
                key: opening.id,
                id: opening.id,
                ...wallPlacement(wall), // local +x -> the wall's direction
                frame: boxesGeometry(parts.frame),
                opens: parts.leaves.some((leaf) => leaf.openAngle !== 0 || leaf.openShift !== 0), // a fixed window: no click
                leaves: parts.leaves.map((leaf) => ({
                    hinge: [leaf.hinge[0], 0, -leaf.hinge[1]],
                    openAngle: leaf.openAngle,
                    openShift: leaf.openShift,
                    leaf: boxesGeometry(leaf.sash ?? [leaf.leaf], leaf.hinge), // a window: its sash around the glass
                    glass: leaf.glass && boxesGeometry([leaf.glass], leaf.hinge),
                    handle: leaf.handle.length ? boxesGeometry(leaf.handle, leaf.hinge) : null
                }))
            });
        }
    }
    return doors;
}

/*
* The selected opening's two resize handles (builder 3D): see the header. `level` is what is drawn (the
* preview while dragging); every move resizes from the COMMITTED level, so the result never drifts.
*/
function ResizeHandles({ level, wallId, openingId }) {
    const getThree = useThree((state) => state.get); // controls read at event time (OrbitControls makeDefault)
    const dragRef = useRef(null); // { edge, y } while dragging (handlers)
    const [dragging, setDragging] = useState(null); // the dragged edge (render: its handle stays white)
    const [hovered, setHovered] = useState(null);
    const setOrbit = (enabled) => {
        const { controls } = getThree();
        if (controls) controls.enabled = enabled;
    };
    useEffect(() => () => setCursorHover('builder-opening-edge', false), []);
    const wall = level.walls.find((item) => item.id === wallId);
    const opening = wall?.openings?.find((item) => item.id === openingId);
    const rect = opening && openingRects({ ...wall, openings: [opening] }, wall.height ?? level.wallHeight)[0];
    if (rect == null) return null;
    const { inner, outer } = faceOffsets(wall);
    const axis = (inner + outer) / 2;
    const y = rect.bottom + HANDLE_LIFT;
    const { position, rotationY } = wallPlacement(wall);
    // dimensions: [key, value (m), start, end] in the room's frame (world positions; label at the middle)
    const { dir, normal } = wallFrame(wall);
    const gaps = openingClearances(level, wallId, openingId);
    const wallTop = wall.height ?? level.wallHeight;
    const across = inner - Math.sign(outer - inner) * GAP_FACE_OFFSET; // off the inner face, towards the room
    const at = (t, height) => [wall.a[0] + dir[0] * t + normal[0] * across, height, wall.a[1] + dir[1] * t + normal[1] * across];
    const middle = (rect.from + rect.to) / 2;
    const dimensions = [
        ...(gaps == null ? [] : [['before', gaps.before, gaps.from], ['after', gaps.to, gaps.after]]
            .map(([key, t0, t1]) => [key, t1 - t0, at(t0, y), at(t1, y)])),
        ['above', wallTop - rect.top, at(middle, rect.top), at(middle, wallTop)],
        ...(rect.bottom > 0 ? [['below', rect.bottom, at(middle, 0), at(middle, rect.bottom)]] : [])
    ].filter(([, value]) => value > GAP_MIN);
    // all dimension lines in one geometry: each segment plus a tick across it at both ends (in the wall's
    // plane: horizontal lines get vertical ticks, vertical lines horizontal ones along the wall)
    const linePoints = dimensions.flatMap(([, , p, q]) => {
        const isVertical = Math.abs(p[1] - q[1]) > 1e-6;
        const tick = isVertical ? [dir[0] * TICK, 0, dir[1] * TICK] : [0, TICK, 0];
        const ticks = [p, q].flatMap((e) => [[e[0] - tick[0], e[1] - tick[1], e[2] - tick[2]], [e[0] + tick[0], e[1] + tick[1], e[2] + tick[2]]]);
        return [p, q, ...ticks];
    }).flat();

    const onDown = (event, edge) => {
        event.stopPropagation();
        event.target.setPointerCapture?.(event.pointerId);
        setOrbit(false); // no orbit while dragging
        dragRef.current = { edge, y };
        setDragging(edge);
    };
    const onMove = (event) => {
        const drag = dragRef.current;
        if (drag == null) return;
        event.stopPropagation();
        if (getPointerRay(event)?.intersectPlane(_plane.set(UP, -drag.y), _hit) == null) return;
        const { plan, settings, setLevelPreview } = useStore.getState();
        const base = activeLevel(plan);
        const baseWall = base.walls.find((item) => item.id === wallId);
        if (baseWall == null) return;
        const { dir } = wallFrame(baseWall);
        let t = (_hit.x - baseWall.a[0]) * dir[0] + (_hit.z - baseWall.a[1]) * dir[1];
        if (settings.gridSnap) t = Math.round(t / (settings.gridSnapStep / 100)) * (settings.gridSnapStep / 100);
        const next = resizeOpening(base, wallId, openingId, drag.edge, t);
        if (next) setLevelPreview(next);
    };
    const onUp = (event) => {
        if (dragRef.current == null) return;
        event.stopPropagation();
        event.target.releasePointerCapture?.(event.pointerId);
        setOrbit(true);
        dragRef.current = null;
        setDragging(null);
        const { levelPreview, setActiveLevel, setLevelPreview } = useStore.getState();
        if (levelPreview) setActiveLevel(levelPreview); // first the plan, then drop the preview: no flash back
        setLevelPreview(null);
    };
    // lost pointer (system gesture): drop the drag and its preview, never commit half of it
    const onCancel = () => {
        if (dragRef.current == null) return;
        setOrbit(true);
        dragRef.current = null;
        setDragging(null);
        useStore.getState().setLevelPreview(null);
    };
    const onHover = (event, edge) => {
        if (event.nativeEvent?.pointerType !== 'mouse') return;
        setHovered(edge);
        setCursorHover('builder-opening-edge', edge != null);
    };

    return (
        <>
        <lineSegments material={dimensionMaterial} renderOrder={10} raycast={noRaycast} frustumCulled={false}>
            {/* key: a new buffer whenever the points change (their count differs between gesture frames) */}
            <bufferGeometry key={linePoints.join(',')}>
                <bufferAttribute attach="attributes-position" args={[new Float32Array(linePoints), 3]} />
            </bufferGeometry>
        </lineSegments>
        {dimensions.map(([key, value, p, q]) => (
            <Html key={key} position={[(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
                <span className="plan-length-3d">{`${value.toFixed(2)} m`}</span>
            </Html>
        ))}
        <group position={position} rotation-y={rotationY}>
            {[['start', rect.from, Math.PI], ['end', rect.to, 0]].map(([edge, x, turn]) => (
                // local frame: z = -c; the triangle points along +x, turned by PI for the start edge
                <mesh key={edge} geometry={triangle} position={[x, y, -axis]} rotation-y={turn} renderOrder={10}
                    material={hovered === edge || dragging === edge ? edgeHoverMaterial : edgeMaterial}
                    pointerEventsOrder={2}
                    onPointerDown={(event) => onDown(event, edge)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
                    onClick={(event) => event.stopPropagation()}
                    onPointerOver={(event) => onHover(event, edge)} onPointerOut={(event) => onHover(event, null)} />
            ))}
        </group>
        </>
    );
}

export default function Openings3D({ level }) {
    const doors = useMemo(() => buildDoors(level), [level]);
    const openDoors = useStore((state) => state.openDoors);
    const isBuilder = useStore((state) => state.workspace === 'builder');
    const selectedOpening = useStore((state) => (state.workspace === 'builder' ? state.selectedOpening : null));
    const selectedId = selectedOpening?.openingId;
    const is3DView = useStore((state) => state.builderView === '3d');
    const pickBoxes = useMemo(() => (isBuilder ? buildPickBoxes(level) : []), [isBuilder, level]);
    useEffect(() => () => pickBoxes.forEach((pick) => pick.geometry.dispose()), [pickBoxes]);
    const [hoveredId, setHoveredId] = useState(null);
    useEffect(() => () => { setCursorHover('builder-opening', false); setHoveredId(null); }, [isBuilder]);
    // tint of an opening: selected beats hovered (builder only: both are null elsewhere)
    // DESIGNER: the door under the mouse (a click toggles it)
    const pickDoors = !isBuilder; // designer: door parts are pickable
    const [hoveredDoorId, setHoveredDoorId] = useState(null);
    useEffect(() => () => { setCursorHover('designer-door', false); setHoveredDoorId(null); }, [isBuilder]);
    const onDoorHover = (event, doorId) => {
        if (event.nativeEvent?.pointerType !== 'mouse') return;
        setCursorHover('designer-door', doorId != null);
        setHoveredDoorId(doorId);
    };
    // tint of an opening: builder = selected beats hovered; designer = the hovered door only
    const tintOf = (id) => (isBuilder
        ? (id === selectedId ? true : id === hoveredId ? 'hover' : false)
        : (id === hoveredDoorId ? 'hover' : false));
    const pivotsRef = useRef(new Map()); // '<opening>:<index>' -> pivot group (mounted)
    const progressRef = useRef(new Map()); // '<opening>:<index>' -> current progress (0 closed .. 1 open)

    // leaves eased towards open / closed (a leaf without a stored progress snaps: no animation on load)
    useFrame((_state, delta) => {
        const progress = progressRef.current;
        const k = 1 - Math.exp(-OPEN_SPEED * Math.min(delta, 0.1));
        for (const door of doors) {
            door.leaves.forEach((leaf, index) => {
                const key = `${door.id}:${index}`;
                const pivot = pivotsRef.current.get(key);
                if (pivot == null) return;
                const target = openDoors[door.id] ? 1 : 0;
                let p = progress.get(key) ?? target;
                p = Math.abs(target - p) < SETTLED ? target : p + (target - p) * k;
                progress.set(key, p);
                pivot.rotation.y = p * leaf.openAngle;
                pivot.position.x = leaf.hinge[0] + p * leaf.openShift; // the group's local x = along the wall
            });
        }
    });
    useEffect(() => () => doors.forEach((door) => {
        door.frame.dispose();
        door.leaves.forEach((leaf) => { leaf.leaf.dispose(); leaf.glass?.dispose(); leaf.handle?.dispose(); });
    }), [doors]);

    // designer: pointer handlers shared by every part of a door (a group catches its children's events)
    const doorHandlers = (door) => (pickDoors && door.opens ? {
        onClick: (event) => onDoorClick(event, door.id),
        onPointerOver: (event) => onDoorHover(event, door.id),
        onPointerOut: (event) => onDoorHover(event, null)
    } : {});
    // builder: the pick boxes take the clicks. Designer: the mesh's own raycast, passed EXPLICITLY: R3F ignores
    // an `undefined` prop, so a door mounted in the builder kept noRaycast after switching to the designer
    const partRaycast = pickDoors ? Mesh.prototype.raycast : noRaycast;

    return [...doors.map((door) => (
        <group key={door.key} position={door.position} rotation-y={door.rotationY} {...doorHandlers(door)}>
            <mesh geometry={door.frame} material={partMaterial('frame', tintOf(door.id))} userData={DOOR_USER_DATA(door.id, 'frame')} raycast={partRaycast} castShadow receiveShadow />
            {door.leaves.map((leaf, index) => (
                // pivot on the hinge axis: turned / moved by the eased progress (useFrame)
                <group key={index} position={leaf.hinge} ref={(pivot) => {
                    const key = `${door.id}:${index}`;
                    if (pivot) pivotsRef.current.set(key, pivot);
                    else pivotsRef.current.delete(key);
                }}>
                    <mesh geometry={leaf.leaf} material={partMaterial('leaf', tintOf(door.id))} userData={DOOR_USER_DATA(door.id, 'leaf')} raycast={partRaycast} castShadow receiveShadow />
                    {leaf.glass && <mesh geometry={leaf.glass} material={partMaterial('glass', tintOf(door.id))} userData={DOOR_USER_DATA(door.id, 'glass')} raycast={partRaycast} />}
                    {leaf.handle && <mesh geometry={leaf.handle} material={partMaterial('handle', tintOf(door.id))} userData={DOOR_USER_DATA(door.id, 'handle')} raycast={partRaycast} castShadow />}
                </group>
            ))}
        </group>
    )), ...pickBoxes.map((pick) => (
        <mesh key={`pick:${pick.key}`} geometry={pick.geometry} position={pick.position} rotation-y={pick.rotationY}
            material={pick.isDoor || !tintOf(pick.openingId) ? pickMaterial : tintOf(pick.openingId) === 'hover' ? pickHoverMaterial : pickSelectedMaterial}
            renderOrder={1}
            onClick={(event) => onPickClick(event, pick.wallId, pick.openingId)}
            onPointerOver={(event) => onPickHover(event, pick.openingId, setHoveredId)}
            onPointerOut={(event) => onPickHover(event, null, setHoveredId)} />
    )), selectedOpening && is3DView && <ResizeHandles key="resize" level={level} {...selectedOpening} />];
}
