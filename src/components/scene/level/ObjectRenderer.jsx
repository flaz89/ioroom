import { useStore } from "../../../store/appStore"
import { useXR } from "@react-three/xr"
import { PivotControls } from "@react-three/drei"

export default function ObjectRenderer() {

    const instances = useStore((state) => state.objects.instances)
    
    const { mode } = useXR();
    const isVR = mode === "immersive-vr";
    const isAR = mode === "immersive-ar";
    const isFlatscreen = !isVR && !isAR;

    return(
    <>
        {instances.map((obj) => {
            // Test semplice: renderizza sempre un box
            const meshContent = (
            <mesh 
                position={obj.position}
                rotation={obj.rotation}
                scale={obj.scale}
                castShadow
            >
                <boxGeometry />
                <meshStandardMaterial color={obj.color} />
            </mesh>
            );
        
            // Wrappa con PivotControls solo se flatscreen
            if (isFlatscreen) {
            return (
                <PivotControls
                key={obj.id}
                depthTest={false}
                anchor={[0, 0, 0]}
                >
                {meshContent}
                </PivotControls>
            );
            }
        
            // Altrimenti solo la mesh
            return <group key={obj.id}>{meshContent}</group>;
        })}
    </>
    );
}