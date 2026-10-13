// Marks wall meshes for surfaceDrag: objects placed on them turn to face into the room
const WALL_USER_DATA = { surface: 'wall' };

export default function Room({sizes}) {

    const [x, z] = sizes;
    const wallThickness = .15;
    const wallHeight = 2.7;


    return(
        <group>
            {/* ------------- FLOOR ------------------ */}
            <mesh
                rotation={[-Math.PI / 2, 0, 0]} 
                position={[0, 0, 0]}
                receiveShadow
            >
                <planeGeometry args={[x, z]} />
                <meshStandardMaterial color="#d4d4d4" /> 
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
                receiveShadow
            >
                <boxGeometry args={[wallThickness, wallHeight, z]}/>
                <meshStandardMaterial />
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
            >
                <boxGeometry args={[wallThickness, wallHeight, z]}/>
                <meshStandardMaterial />
            </mesh>

            {/* ------------- WALL back ------------------ */}
            <mesh
                userData={WALL_USER_DATA}
                position={[0, wallHeight * .5, -(z * .5) - wallThickness * .5]}
                rotation-y={Math.PI * .5}receiveShadow
            >
                <boxGeometry args={[wallThickness, wallHeight, x + wallThickness * 2]}/>
                <meshStandardMaterial />
            </mesh>
        </group>
    )
}