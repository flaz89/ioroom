import SurfaceMaterial from './SurfaceMaterial';

/*
* userData of the room meshes:
* - surface: 'wall' -> surfaceDrag.js: objects placed on walls turn to face into the room;
* - surfaceId -> materials: the id the surface's material is saved under (store `surfaces`) and the drop
*   target of the materials panel (MaterialDropTarget.jsx).
* Every wall casts AND receives shadows: the sun can come from any side (sun light: components/light/Light.jsx).
*/
const FLOOR_USER_DATA = { surfaceId: 'floor' };
const WALL_LEFT_USER_DATA = { surface: 'wall', surfaceId: 'wall-left' };
const WALL_RIGHT_USER_DATA = { surface: 'wall', surfaceId: 'wall-right' };
const WALL_BACK_USER_DATA = { surface: 'wall', surfaceId: 'wall-back' };

// Marks the room for post-it placing (components/scene/notes/Notes.jsx): its surfaces take notes.
const ROOM_USER_DATA = { isRoom: true };

/*
* The fixed test room: floor, invisible ceiling, three walls (left, right, back). Each visible surface
* takes the material dropped on it (SurfaceMaterial.jsx), tiled at real scale on the face the room sees
* (box faces span their own 0..1 UVs).
*/
export default function Room({sizes}) {

    const [x, z] = sizes;
    const wallThickness = .15;
    const wallHeight = 2.7;


    return(
        <group userData={ROOM_USER_DATA}>
            {/* ------------- FLOOR ------------------ */}
            <mesh
                rotation={[-Math.PI / 2, 0, 0]} 
                position={[0, 0, 0]}
                userData={FLOOR_USER_DATA}
                receiveShadow
            >
                <planeGeometry args={[x, z]} />
                <SurfaceMaterial surfaceId="floor" size={[x, z]} color="#d4d4d4" />
            </mesh>

            {/* ------------- CEILING (invisible) ------------------ */}
            {/* Not rendered: only a surface for placing objects (lamps) with surfaceDrag. Faces down. */}
            <mesh
                rotation={[Math.PI / 2, 0, 0]}
                position={[0, wallHeight, 0]}
                visible={false}
            >
                <planeGeometry args={[x, z]} />
            </mesh>

            {/* ------------- WALL left ------------------ */}
            <mesh
                userData={WALL_LEFT_USER_DATA}
                position={[
                    -(x * .5) - (wallThickness * .5),
                    wallHeight * .5,
                    0
                ]}
                castShadow
                receiveShadow
            >
                <boxGeometry args={[wallThickness, wallHeight, z]}/>
                <SurfaceMaterial surfaceId="wall-left" size={[z, wallHeight]} color="#ffffff" />
            </mesh>

            {/* ------------- WALL right ------------------ */}
            <mesh
                userData={WALL_RIGHT_USER_DATA}
                position={[
                    x * .5 + (wallThickness * .5),
                    wallHeight * .5,
                    0
                ]}
                castShadow
                receiveShadow
            >
                <boxGeometry args={[wallThickness, wallHeight, z]}/>
                <SurfaceMaterial surfaceId="wall-right" size={[z, wallHeight]} color="#ffffff" />
            </mesh>

            {/* ------------- WALL back ------------------ */}
            <mesh
                userData={WALL_BACK_USER_DATA}
                position={[0, wallHeight * .5, -(z * .5) - wallThickness * .5]}
                rotation-y={Math.PI * .5}
                castShadow
                receiveShadow
            >
                <boxGeometry args={[wallThickness, wallHeight, x + wallThickness * 2]}/>
                <SurfaceMaterial surfaceId="wall-back" size={[x + wallThickness * 2, wallHeight]} color="#ffffff" />
            </mesh>
        </group>
    )
}