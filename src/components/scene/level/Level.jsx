import { PivotControls, RoundedBoxGeometry, Text } from "@react-three/drei";
import { useXR } from "@react-three/xr";
import Room from "./room/Room";
import ObjectRenderer from "./ObjectRenderer";

export default function Level() {

    const { mode } = useXR();
    const isVR = mode === "immersive-vr"
    const isAR = mode === "immersive-ar"
    

    return(
        <>
            {/* Only VR */}
            { isVR && <color args={["rgb(42, 66, 165)"]} attach="background"/> }

            {/* Only VR || Flatscreen */}
            {/* ----------- ROOM ---------------- */}
            {!isAR && <Room sizes={[6, 6]}/>}

            {/* Objects in the scene */}
            <ObjectRenderer />

        </>
    );
}