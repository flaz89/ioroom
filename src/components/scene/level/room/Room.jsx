// Marks wall meshes for surfaceDrag: objects placed on them turn to face into the room.
// Every wall casts AND receives shadows: the sun can come from any side (sun light: components/light/Light.jsx).
const WALL_USER_DATA = { surface: 'wall' };

import SurfaceMaterial from './SurfaceMaterial';

// Marks the room for post-it placing (components/scene/notes/Notes.jsx): its surfaces take notes.
const ROOM_USER_DATA = { isRoom: true };

/*
* The fixed test room: floor, invisible ceiling, three walls (left, right, back). Each visible surface
* takes the material picked for it (SurfaceMaterial.jsx; ids in surfaceMaterials.js ROOM_SURFACES), tiled
* at real scale on the face the room sees (box faces span their own 0..1 UVs).
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
                userData={WALL_USER_DATA}
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
                userData={WALL_USER_DATA}
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
                userData={WALL_USER_DATA}
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