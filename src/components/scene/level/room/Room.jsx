import { useEffect, useMemo } from 'react';
import SurfaceMesh from './SurfaceMesh';
import { boxFaces, floorGeometry, mergeFaces } from './roomGeometry';
import { useStore } from '../../../../store/appStore';
import { PLAIN_ID } from '../../../../materials/library';

const WALL_HEIGHT = 2.7;
const WALL_THICKNESS = 0.15;
const FLOOR_COLOR = '#d4d4d4'; // plain material colors
const WALL_COLOR = '#ffffff';
const VERTICAL_FACES = ['px', 'nx', 'pz', 'nz'];

/*
* Face ids (surfaceId): the key a face's material is saved under (store `surfaces`) and what the
* materials panel drops onto: 'floor', '<wall>:inner' (the side the room sees), '<wall>:outer',
* '<wall>:edge' (top and ends).
* userData of the merged meshes (one per batch, see Room):
* - faceRanges: triangle ranges -> face id (roomGeometry.js surfaceIdAt; MaterialDropTarget.jsx);
* - surface: 'wall' on vertical batches -> surfaceDrag.js: objects placed on walls turn into the room.
* Vertical wall faces cast AND receive shadows (the sun can come from any side, Light.jsx); horizontal
* faces (floor, wall tops) only receive them.
*/
// Marks the room for post-it placing (components/scene/notes/Notes.jsx): its surfaces take notes.
const ROOM_USER_DATA = { isRoom: true };
/*
* XR touch/grab pointers test a mesh's BOUNDING BOX, not its triangles: a batch merging three walls has a
* box as big as the room, so hands would always "touch" it and that contact beats the ray (nothing works).
* The room only takes rays (and the mouse).
*/
const ROOM_POINTER_TYPES = { deny: ['touch', 'grab'] };

/*
* The fixed test room: floor, invisible ceiling, three walls (left, right, back). Every face has its own
* material (world-space UVs: roomGeometry.js), but faces are RENDERED in batches: all the faces sharing
* the same material, plain color, preview tint and orientation (vertical / horizontal) are merged into
* one mesh, so the room costs one draw call (plus one shadow draw call) per batch instead of one per
* face. Batches are rebuilt when a material changes (or a dragged material previews on a face): a few
* hundred vertices, cheap.
* ponytail: walls are fixed boxes around a [x, z] room; rooms from plans will describe walls as data.
*/
export default function Room({ sizes }) {
    const [x, z] = sizes;

    // Every face of the room: { key, geometry, surfaceId, vertical, color }, built once per room size
    const faces = useMemo(() => {
        const h = WALL_HEIGHT, t = WALL_THICKNESS;
        const wall = (id, center, size, inner, outer) => Object.entries(boxFaces(center, size)).map(([face, geometry]) => ({
            key: `${id}-${face}`,
            geometry,
            surfaceId: `${id}:${face === inner ? 'inner' : face === outer ? 'outer' : 'edge'}`,
            vertical: VERTICAL_FACES.includes(face),
            color: WALL_COLOR
        }));
        return [
            { key: 'floor', geometry: floorGeometry(x, z), surfaceId: 'floor', vertical: false, color: FLOOR_COLOR },
            ...wall('wall-left', [-(x + t) / 2, h / 2, 0], [t, h, z], 'px', 'nx'),
            ...wall('wall-right', [(x + t) / 2, h / 2, 0], [t, h, z], 'nx', 'px'),
            ...wall('wall-back', [0, h / 2, -(z + t) / 2], [x + 2 * t, h, t], 'pz', 'nz')
        ];
    }, [x, z]);
    useEffect(() => () => faces.forEach((face) => face.geometry.dispose()), [faces]);

    // Material of each face: saved, or previewed while a material is dragged over it
    const surfaces = useStore((state) => state.surfaces);
    const drag = useStore((state) => state.materialDrag);

    // Batches: faces grouped by (material, tint, orientation, plain color), each merged into one geometry
    const batches = useMemo(() => {
        const groups = new Map();
        for (const face of faces) {
            const previewed = drag?.surfaceId === face.surfaceId;
            const materialId = previewed ? drag.materialId : (surfaces[face.surfaceId] ?? PLAIN_ID);
            const key = `${materialId}|${previewed}|${face.vertical}|${face.color}`;
            if (!groups.has(key)) groups.set(key, { key, materialId, tinted: previewed, vertical: face.vertical, color: face.color, faces: [] });
            groups.get(key).faces.push(face);
        }
        return [...groups.values()].map((group) => {
            const { geometry, faceRanges } = mergeFaces(group.faces);
            return { ...group, geometry, userData: { faceRanges, ...(group.vertical ? { surface: 'wall' } : {}) } };
        });
    }, [faces, surfaces, drag]);
    useEffect(() => () => batches.forEach((batch) => batch.geometry.dispose()), [batches]);

    return (
        <group userData={ROOM_USER_DATA} pointerEventsType={ROOM_POINTER_TYPES}>
            {/* ------------- FLOOR + WALLS: one mesh per material batch ------------------ */}
            {batches.map((batch) => (
                <SurfaceMesh
                    key={batch.key}
                    materialId={batch.materialId}
                    tinted={batch.tinted}
                    color={batch.color}
                    geometry={batch.geometry}
                    userData={batch.userData}
                    castShadow={batch.vertical}
                    receiveShadow
                />
            ))}

            {/* ------------- CEILING (invisible) ------------------ */}
            {/* Not rendered: only a surface for placing objects (lamps) with surfaceDrag. Faces down. */}
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, WALL_HEIGHT, 0]} visible={false}>
                <planeGeometry args={[x, z]} />
            </mesh>
        </group>
    );
}
