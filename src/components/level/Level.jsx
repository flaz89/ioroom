import { PivotControls, Text, Grid } from "@react-three/drei";
import { useXR } from "@react-three/xr";

export default function Level() {

    const { mode } = useXR();
    

    return(
        <>
            {/* background color only present in VR */}
            {mode === "immersive-vr" && <color args={["rgb(42, 66, 165)"]} attach="background"/>}

            <Grid 
                args={[20, 20]} 
                cellSize={.5}
                cellThickness={.5}
                cellColor="#555555"
                sectionSize={2}
                sectionThickness={1}
                sectionColor="#888888"
                fadeDistance={25}
                fadeStrength={1}
                followCamera={false}
                infiniteGrid={false}
            />

            {/* OBJECT TEST */}
            <PivotControls
                depthTest={ false }
                anchor={ [0,0,0] }
            >
                <mesh castShadow position-y={.5}>
                    <boxGeometry />
                    <meshStandardMaterial />
                    <Text
                    position-y={1}
                    center
                    fontSize={.2}
                    >{mode || "flat screen"}</Text>
                </mesh>
            </PivotControls>
        </>
    );
}