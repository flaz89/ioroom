import { useEffect, useMemo } from 'react';
import SurfaceMesh from './SurfaceMesh';
import { boxFaces, floorGeometry } from './roomGeometry';

const WALL_HEIGHT = 2.7;
const WALL_THICKNESS = 0.15;
const FLOOR_COLOR = '#d4d4d4'; // plain material colors
const WALL_COLOR = '#ffffff';
const VERTICAL_FACES = ['px', 'nx', 'pz', 'nz'];

/*
* userData of the room meshes:
* - surface: 'wall' (vertical wall faces) -> surfaceDrag.js: objects placed on walls turn to face into the room;
* - surfaceId -> materials: the id the face's material is saved under (store `surfaces`) and the drop
*   target of the materials panel (MaterialDropTarget.jsx). Walls: "<wall>:inner" (the side the room
*   sees), "<wall>:outer", "<wall>:edge" (top and ends).
* Every wall face casts AND receives shadows: the sun can come from any side (components/light/Light.jsx).
*/
const FLOOR_USER_DATA = { surfaceId: 'floor' };

// Marks the room for post-it placing (components/scene/notes/Notes.jsx): its surfaces take notes.
const ROOM_USER_DATA = { isRoom: true };

/*
* The fixed test room: floor, invisible ceiling, three walls (left, right, back). Every face is its own
* mesh (one draw call per face, the same as a multi-material box) with world-space UVs (roomGeometry.js),
* so each face takes its own material (SurfaceMesh.jsx) at real scale, continuous across faces.
* ponytail: walls are fixed boxes around a [x, z] room; rooms from plans will describe walls as data.
*/
export default function Room({ sizes }) {
    const [x, z] = sizes;

    // Faces of every wall + the floor, built once per room size (room space: meshes stay at the origin)
    const { floor, walls } = useMemo(() => {
        const h = WALL_HEIGHT, t = WALL_THICKNESS;
        const wall = (id, center, size, inner, outer) => {
            const faces = boxFaces(center, size);
            return Object.entries(faces).map(([face, geometry]) => ({
                key: `${id}-${face}`,
                geometry,
                userData: {
                    surfaceId: `${id}:${face === inner ? 'inner' : face === outer ? 'outer' : 'edge'}`,
                    ...(VERTICAL_FACES.includes(face) ? { surface: 'wall' } : {})
                }
            }));
        };
        return {
            floor: floorGeometry(x, z),
            walls: [
                ...wall('wall-left', [-(x + t) / 2, h / 2, 0], [t, h, z], 'px', 'nx'),
                ...wall('wall-right', [(x + t) / 2, h / 2, 0], [t, h, z], 'nx', 'px'),
                ...wall('wall-back', [0, h / 2, -(z + t) / 2], [x + 2 * t, h, t], 'pz', 'nz')
            ]
        };
    }, [x, z]);
    useEffect(() => () => {
        floor.dispose();
        walls.forEach((face) => face.geometry.dispose());
    }, [floor, walls]);

    return (
        <group userData={ROOM_USER_DATA}>
            {/* ------------- FLOOR ------------------ */}
            <SurfaceMesh surfaceId="floor" color={FLOOR_COLOR} geometry={floor} userData={FLOOR_USER_DATA} receiveShadow />

            {/* ------------- CEILING (invisible) ------------------ */}
            {/* Not rendered: only a surface for placing objects (lamps) with surfaceDrag. Faces down. */}
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, WALL_HEIGHT, 0]} visible={false}>
                <planeGeometry args={[x, z]} />
            </mesh>

            {/* ------------- WALLS: one mesh per face ------------------ */}
            {walls.map((face) => (
                <SurfaceMesh key={face.key} surfaceId={face.userData.surfaceId} color={WALL_COLOR}
                    geometry={face.geometry} userData={face.userData} castShadow receiveShadow />
            ))}
        </group>
    );
}
