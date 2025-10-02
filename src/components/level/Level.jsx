import { PivotControls, Text } from "@react-three/drei";
import { useXR } from "@react-three/xr";

export default function Level() {

    const { mode } = useXR();
    const isImmersed = mode === "immersive-vr" || mode === "immersive-ar"
    

    return(
        <>
            {/* background color only present in VR */}
            {isImmersed && <color args={["rgb(42, 66, 165)"]} attach="background"/>}

            {/* OBJECT TEST */}
            {!isImmersed ? 
                <PivotControls
                    depthTest={ false }
                    anchor={ [0,0,0] }
                >
                    <mesh castShadow position-y={.5} pointerEventsType={{ deny: 'grab' }}>
                        <boxGeometry />
                        <meshStandardMaterial />
                        <Text
                        position-y={1}
                        center
                        fontSize={.2}
                        >{mode || "flat screen"}</Text>
                    </mesh>
                </PivotControls> 
            :
                <mesh castShadow position-y={.5} pointerEventsType={{ deny: 'grab' }}>
                    <boxGeometry />
                    <meshStandardMaterial />
                    <Text
                    position-y={1}
                    center
                    fontSize={.2}
                    >{mode || "flat screen"}</Text>
                </mesh>
            }
        </>
    );
}