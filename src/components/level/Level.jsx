import { PivotControls, Text } from "@react-three/drei";
import { useXR } from "@react-three/xr";

export default function Level() {

    const { mode } = useXR();
    const isVR = mode === "immersive-vr"
    const isAR = mode === "immersive-ar"
    

    return(
        <>
            {/* background color only present in VR */}
            {isVR && <color args={["rgb(42, 66, 165)"]} attach="background"/>}

            {/* OBJECT TEST */}
            {!isAR && !isVR ? 
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