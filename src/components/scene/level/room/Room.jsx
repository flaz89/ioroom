import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { aoAtlas } from './aoAtlas';
import { bakeRoomAo } from './aoBaker';
import { isRoomAoFor, setRoomAo, showRoomAoCeilings } from './roomAo';
import { setCursorHover } from '../../sceneCursor';
import SurfaceMesh from './SurfaceMesh';
import UnderlayPlane from './UnderlayPlane';
import Openings3D from './Openings3D';
import { isStillClick, recordPress } from './builderClick';
import { mergeFaces, spherecastFaces, surfaceIdAt } from './roomGeometry';
import { polygonGeometry, roomFaces } from './roomLayout';
import { useStore } from '../../../../store/appStore';
import { PLAIN_ID } from '../../../../materials/library';
import { activeLevel, beamsFaceId, ceilingSidesFaceId, dormerWallsFaceId } from '../../../../plan/planModel';

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
// where a dragged material would land: a door / window (its parts carry openingId: Openings3D.jsx) or a face
const dropTargetOf = (event) => event.object.userData.openingId ?? faceOf(event);
function onDragMove(event) {
    const drag = vrDragOf(event);
    if (drag != null) useStore.getState().setMaterialDrag({ ...drag, surfaceId: dropTargetOf(event) });
}
function onDragLeave(event) {
    const drag = vrDragOf(event);
    if (drag != null) useStore.getState().setMaterialDrag({ ...drag, surfaceId: null });
}
function onDragDrop(event) {
    const drag = vrDragOf(event);
    if (drag == null) return;
    event.stopPropagation();
    const surfaceId = dropTargetOf(event);
    if (surfaceId != null) useStore.getState().dropMaterial(surfaceId, drag.materialId); // VR: one at a time
    useStore.getState().setMaterialDrag(null);
}

/*
* BUILDER (store workspace 'builder', 3D view): a click on a wall face selects that wall (store
* selectedWallIds, shared with the 2D plan; WallPanel.jsx shows its sizes), a click on a floor deselects.
* Not while a tool owns the click (ruler, post-it) and not at the end of an orbit drag (builderClick.js).
* The selected wall's faces are tinted like a material preview. Doors / windows: Openings3D.jsx.
*/
const NO_WALLS = []; // stable empty selection outside the builder
const BAKE_DELAY = 400; // ms of a still plan before the AO bake starts
const onBuilderPress = recordPress;
function onBuilderClick(event) {
    const state = useStore.getState();
    if (state.measures.active || state.notes.placing) return;
    if (!isStillClick(event)) return;
    // DESIGNER: a click on anything of the room (wall, floor, ceiling, roof; doors and windows deselect on their
    // own, Openings3D.jsx) deselects the object. Only a click on nothing used to: in VR, inside a real plan,
    // there is no "nothing" around (walls, roof, floors everywhere)
    if (state.workspace !== 'builder') {
        if (state.objects.selectedId != null) state.deselectObject();
        return;
    }
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
    // the plan's level, or a 3D builder gesture's local preview (workspaceSlice levelPreview)
    const level = useStore((state) => state.levelPreview ?? activeLevel(state.plan));

    // Builder with a floor plan UNDERLAY shown (this device: store underlayVisible): the drawing lies on the
    // floor (UnderlayPlane) and the floors are not drawn; hidden = the floors are back. A DXF is only lines:
    // drawn over the floors, which stay (something to see between the lines, and to measure on)
    const underlayOpacity = useStore((state) => state.underlayOpacity);
    const showUnderlay = useStore((state) => state.workspace === 'builder' && state.underlayVisible) && level.underlay != null;

    // Every face of the room (roomLayout.js: also measured by the bill of quantities), rebuilt when the plan changes
    const plainFaces = useMemo(() => roomFaces(level), [level]);
    const isXR = useXR((state) => state.mode != null);
    // Ceilings: hidden by this device's toggle (store ceilingVisible) and always in the XR tabletop view
    // (the miniature is looked at from above: a lid would hide the room). Their faces: roof pitches / ceiling,
    // exposed beams, dormer walls, false ceiling sides
    const showCeilings = useStore((state) => state.ceilingVisible && !(isXR && state.view.mode === 'tabletop'));
    const ceilingIds = useMemo(() => new Set((level.ceilings ?? []).flatMap((ceiling) =>
        [ceiling.id, beamsFaceId(ceiling.id), dormerWallsFaceId(ceiling.id), ceilingSidesFaceId(ceiling.id)])), [level]);

    // BAKED AO (docs/plans/2026-10-29-feat-baked-room-ao-plan.md): shown in XR and on screen without the SSGI (which
    // does its own). The faces get uv1 (aoAtlas.js); BAKE_DELAY after the plan stops changing (drags, undo, edits from
    // another device) the worker bakes it (aoBaker.js); the materials use it only while the bake matches the
    // current atlas (`bakedAtlas`), else the room shows without AO until the next bake lands. A Canvas remount
    // (entering / leaving XR) with the same plan reuses the last bake (roomAo.js isRoomAoFor). Each bake holds the
    // AO with and without the ceilings: hiding them swaps the texture's data, no new bake (showRoomAoCeilings).
    // ALWAYS baked, also on screen with the SSGI (then not shown, `wantsAo`): entering VR finds it ready instead of
    // the room appearing flat and its AO a few seconds later (6 s on a Quest 2). The bake runs in the background
    // workers; on screen it only costs CPU after a plan change.
    const isWebGPU = useThree((state) => state.gl.isWebGPURenderer === true);
    const wantsAo = useStore((state) => isXR || !(state.settings.ssgi && isWebGPU));
    const atlas = useMemo(() => aoAtlas(plainFaces.map((face) => face.geometry)), [plainFaces]);
    const allFaces = useMemo(() => plainFaces.map((face, i) => ({ ...face, geometry: atlas.geometries[i] })), [plainFaces, atlas]);
    useEffect(() => () => atlas.geometries.forEach((geometry) => geometry.dispose()), [atlas]);
    const [bakedAtlas, setBakedAtlas] = useState(null);
    useEffect(() => {
        if (isRoomAoFor(level)) return;
        let alive = true;
        // the result is kept even if this room unmounted meanwhile (roomAo.js is per session: the remounted room
        // finds it with isRoomAoFor, or joins the same running bake)
        const timer = setTimeout(() => bakeRoomAo(atlas, plainFaces.map((face) => ceilingIds.has(face.surfaceId)), level).then((bake) => {
            if (bake == null) return;
            if (!isRoomAoFor(level)) setRoomAo(bake, atlas.size, level);
            if (alive) setBakedAtlas(atlas);
        }), BAKE_DELAY);
        return () => { alive = false; clearTimeout(timer); };
    }, [atlas, level, plainFaces, ceilingIds]);
    const hasAo = wantsAo && (bakedAtlas === atlas || isRoomAoFor(level));
    useEffect(() => { showRoomAoCeilings(showCeilings); }, [showCeilings]);
    const faces = useMemo(() => {
        const hidden = new Set([
            ...(showUnderlay && level.underlay.kind !== 'dxf' ? level.floors.map((floor) => floor.id) : []),
            ...(showCeilings ? [] : ceilingIds)
        ]);
        // wall tops under a roof (roomLayout onlyWithoutRoof): only with the ceilings hidden, else they would lie
        // on the roof's plane
        return allFaces.filter((face) => !hidden.has(face.surfaceId) && !(face.onlyWithoutRoof && showCeilings));
    }, [allFaces, showUnderlay, showCeilings, ceilingIds, level]);
    // Invisible ceiling for placing objects (lamps) while no ceiling is drawn: the floor polygons at wall
    // height, facing down. Drawn ceilings (level.ceilings) are real faces (roomFaces) and replace it.
    const ceilings = useMemo(() => ((level.ceilings ?? []).length > 0 ? []
        : level.floors.map((floor) => polygonGeometry(floor.points, level.wallHeight, true))), [level]);
    useEffect(() => () => ceilings.forEach((geometry) => geometry.dispose()), [ceilings]);
    useEffect(() => () => plainFaces.forEach((face) => face.geometry.dispose()), [plainFaces]);

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
            const castShadow = face.vertical || face.castShadow === true; // walls and ceilings shade the room
            const key = `${materialId}|${tinted}|${face.vertical}|${castShadow}|${face.color}`;
            if (!groups.has(key)) groups.set(key, { key, materialId, tinted, vertical: face.vertical, castShadow, color: face.color, faces: [] });
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
                    ao={hasAo}
                    castShadow={batch.castShadow}
                    receiveShadow
                />
            ))}

            {/* ------------- DOORS: frame, leaves, handles (Openings3D.jsx) ------------------ */}
            <Openings3D level={level} />

            {/* ------------- FLOOR PLAN UNDERLAY (builder) ------------------ */}
            {showUnderlay && <UnderlayPlane underlay={level.underlay} opacity={underlayOpacity} />}

            {/* ------------- CEILING (invisible) ------------------ */}
            {/* Not rendered: only a surface for placing objects (lamps) with surfaceDrag. Faces down. */}
            {ceilings.map((geometry) => <mesh key={geometry.uuid} geometry={geometry} visible={false} />)}
        </group>
    );
}
