import { useEffect, useMemo, useState } from 'react';
import { setCursorHover } from '../../sceneCursor';
import SurfaceMesh from './SurfaceMesh';
import UnderlayPlane from './UnderlayPlane';
import { mergeFaces, spherecastFaces, surfaceIdAt } from './roomGeometry';
import { polygonGeometry, roomFaces } from './roomLayout';
import { useStore } from '../../../../store/appStore';
import { PLAIN_ID } from '../../../../materials/library';
import { activeLevel } from '../../../../plan/planModel';

/*
* Face ids (surfaceId): the key a face's material is saved under (store `surfaces`) and what the
* materials panel drops onto: 'floor', '<wall>:inner' (the side the room sees), '<wall>:outer',
* '<wall>:edge' (top and ends).
* userData of the merged meshes (one per batch, see Room):
* - faceRanges: triangle ranges -> face id (roomGeometry.js surfaceIdAt; MaterialDropTarget.jsx);
* - surface: 'wall' on vertical batches -> surfaceDrag.js: objects placed on walls turn into the room.
* XR sphere pointers (touch, grab: e.g. grabbing the floor to move/turn the tabletop board) test each face
* separately through the meshes' `spherecast` (roomGeometry.js spherecastFaces), not the batch's whole box.
* Vertical wall faces cast AND receive shadows (the sun can come from any side, Light.jsx); horizontal
* faces (floor, wall tops) only receive them.
*/
/*
* VR material drag (xr-ui/VRMaterialsPanel.jsx): the store's materialDrag carries the pointerId of the
* ray that picked the ball. The room follows THAT pointer over its faces (preview) and applies the
* material on its pointerup. Desktop drags have no pointerId: they go through MaterialDropTarget.jsx.
*/
function vrDragOf(event) {
    const drag = useStore.getState().materialDrag;
    return drag?.pointerId != null && drag.pointerId === event.pointerId ? drag : null;
}
const faceOf = (event) => (event.object.userData.faceRanges ? surfaceIdAt(event.object.userData.faceRanges, event.faceIndex) : null);
function onDragMove(event) {
    const drag = vrDragOf(event);
    if (drag != null) useStore.getState().setMaterialDrag({ ...drag, surfaceId: faceOf(event) });
}
function onDragLeave(event) {
    const drag = vrDragOf(event);
    if (drag != null) useStore.getState().setMaterialDrag({ ...drag, surfaceId: null });
}
function onDragDrop(event) {
    const drag = vrDragOf(event);
    if (drag == null) return;
    event.stopPropagation();
    const surfaceId = faceOf(event);
    if (surfaceId != null) useStore.getState().setSurfaceMaterial(surfaceId, drag.materialId);
    useStore.getState().setMaterialDrag(null);
}

/*
* BUILDER (store workspace 'builder', 3D view): a click on a wall face selects that wall (store
* selectedWallIds, shared with the 2D plan; WallPanel.jsx shows its sizes), a click on a floor deselects.
* Not while a tool owns the click (ruler, post-it) and not at the end of an orbit drag: the pointer must
* not have moved more than CLICK_SLOP px since the press (pmndrs events have no usable `delta`: its getter
* throws, so the press position is recorded here). The selected wall's faces are tinted like a material preview.
*/
const CLICK_SLOP = 4; // px
const NO_WALLS = []; // stable empty selection outside the builder
const pressPositions = new Map(); // pointerId -> { x, y } screen position of the last press on the room
function onBuilderPress(event) {
    const native = event.nativeEvent;
    if (native?.clientX != null) pressPositions.set(event.pointerId, { x: native.clientX, y: native.clientY });
}
function onBuilderClick(event) {
    const state = useStore.getState();
    if (state.workspace !== 'builder' || state.measures.active || state.notes.placing) return;
    const press = pressPositions.get(event.pointerId);
    const native = event.nativeEvent;
    if (press && native?.clientX != null && Math.hypot(native.clientX - press.x, native.clientY - press.y) > CLICK_SLOP) return;
    const surfaceId = faceOf(event);
    if (surfaceId == null) return;
    event.stopPropagation();
    state.setSelectedWallId(surfaceId.includes(':') ? surfaceId.split(':')[0] : null);
}

// Marks the room for post-it placing (components/scene/notes/Notes.jsx): its surfaces take notes.
const ROOM_USER_DATA = { isRoom: true };

/*
* The room of a plan level (plan/planModel.js, store `plan`): floors, walls and an invisible ceiling,
* built by roomLayout.js (the default plan is the 6 x 6 m test room). Every face has its own
* material (world-space UVs: roomGeometry.js), but faces are RENDERED in batches: all the faces sharing
* the same material, plain color, preview tint and orientation (vertical / horizontal) are merged into
* one mesh, so the room costs one draw call (plus one shadow draw call) per batch instead of one per
* face. Batches are rebuilt when a material changes (or a dragged material previews on a face): a few
* hundred vertices, cheap.
*/
export default function Room() {
    const level = useStore((state) => activeLevel(state.plan));

    // Builder with a floor plan UNDERLAY shown (this device: store underlayVisible): the drawing lies on the
    // floor (UnderlayPlane) and the floors are not drawn; hidden = the floors are back
    const underlayOpacity = useStore((state) => state.underlayOpacity);
    const showUnderlay = useStore((state) => state.workspace === 'builder' && state.underlayVisible) && level.underlay != null;

    // Every face of the room (roomLayout.js: also measured by the bill of quantities), rebuilt when the plan changes
    const allFaces = useMemo(() => roomFaces(level), [level]);
    const faces = useMemo(() => {
        if (!showUnderlay) return allFaces;
        const floorIds = new Set(level.floors.map((floor) => floor.id));
        return allFaces.filter((face) => !floorIds.has(face.surfaceId));
    }, [allFaces, showUnderlay, level]);
    // Ceiling: the floor polygons at wall height, facing down (no ceiling material yet: not drawn)
    const ceilings = useMemo(() => level.floors.map((floor) => polygonGeometry(floor.points, level.wallHeight, true)), [level]);
    useEffect(() => () => ceilings.forEach((geometry) => geometry.dispose()), [ceilings]);
    useEffect(() => () => allFaces.forEach((face) => face.geometry.dispose()), [allFaces]);

    // Material of each face: saved, or previewed while a material is dragged over it
    const surfaces = useStore((state) => state.surfaces);
    const drag = useStore((state) => state.materialDrag);
    // Builder: selected wall (orange tint) and wall under the mouse (light tint + hand cursor)
    const isBuilder = useStore((state) => state.workspace === 'builder');
    const selectedWallIds = useStore((state) => (state.workspace === 'builder' ? state.selectedWallIds : NO_WALLS));
    const [hoverWallId, setHoverWallId] = useState(null);
    const hoveredWallId = isBuilder ? hoverWallId : null;
    useEffect(() => {
        setCursorHover('builder-wall', hoveredWallId != null);
        return () => setCursorHover('builder-wall', false);
    }, [hoveredWallId]);
    // Mouse over the room: which wall (null over a floor); VR material drags keep their own handler
    const onPointerMove = (event) => {
        onDragMove(event);
        if (!isBuilder || event.nativeEvent?.pointerType !== 'mouse') return; // pmndrs pointerType is its own pointer kind: read the DOM one
        const surfaceId = faceOf(event);
        setHoverWallId(surfaceId?.includes(':') ? surfaceId.split(':')[0] : null);
    };
    const onPointerLeave = (event) => {
        onDragLeave(event);
        setHoverWallId(null);
    };

    // Batches: faces grouped by (material, tint, orientation, plain color), each merged into one geometry
    const batches = useMemo(() => {
        const groups = new Map();
        for (const face of faces) {
            const previewed = drag?.surfaceId === face.surfaceId;
            const selected = selectedWallIds.includes(face.surfaceId.split(':')[0]);
            const hovered = hoveredWallId != null && face.surfaceId.startsWith(`${hoveredWallId}:`);
            const materialId = previewed ? drag.materialId : (surfaces[face.surfaceId] ?? PLAIN_ID);
            const tinted = previewed || selected || (hovered ? 'hover' : false); // SurfaceMesh: 'hover' = lighter
            const key = `${materialId}|${tinted}|${face.vertical}|${face.color}`;
            if (!groups.has(key)) groups.set(key, { key, materialId, tinted, vertical: face.vertical, color: face.color, faces: [] });
            groups.get(key).faces.push(face);
        }
        return [...groups.values()].map((group) => {
            const { geometry, faceRanges } = mergeFaces(group.faces);
            return { ...group, geometry, spherecast: spherecastFaces(faceRanges), userData: { faceRanges, ...(group.vertical ? { surface: 'wall' } : {}) } };
        });
    }, [faces, surfaces, drag, selectedWallIds, hoveredWallId]);
    useEffect(() => () => batches.forEach((batch) => batch.geometry.dispose()), [batches]);

    return (
        <group userData={ROOM_USER_DATA} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} onPointerUp={onDragDrop} onPointerDown={onBuilderPress} onClick={onBuilderClick}>
            {/* ------------- FLOOR + WALLS: one mesh per material batch ------------------ */}
            {batches.map((batch) => (
                <SurfaceMesh
                    key={batch.key}
                    materialId={batch.materialId}
                    tinted={batch.tinted}
                    color={batch.color}
                    geometry={batch.geometry}
                    userData={batch.userData}
                    spherecast={batch.spherecast}
                    castShadow={batch.vertical}
                    receiveShadow
                />
            ))}

            {/* ------------- FLOOR PLAN UNDERLAY (builder) ------------------ */}
            {showUnderlay && <UnderlayPlane underlay={level.underlay} opacity={underlayOpacity} />}

            {/* ------------- CEILING (invisible) ------------------ */}
            {/* Not rendered: only a surface for placing objects (lamps) with surfaceDrag. Faces down. */}
            {ceilings.map((geometry) => <mesh key={geometry.uuid} geometry={geometry} visible={false} />)}
        </group>
    );
}
