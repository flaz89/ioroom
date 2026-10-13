import { useXR } from "@react-three/xr";
import Room from "./room/Room";
import Board from "./Board";
import ObjectRenderer from "./ObjectRenderer";
import WristMenu from "../xr-ui/WristMenu";
import FistDeleteGesture from "../xr-ui/FistDeleteGesture";
import PinchRotateGesture from "../xr-ui/PinchRotateGesture";
import { useStore } from "../../../store/appStore";

export default function Level() {

    const { mode } = useXR();
    const isVR = mode === "immersive-vr"
    const isAR = mode === "immersive-ar"
    const isXR = isVR || isAR;
    // Tabletop (miniature) view exists only inside XR sessions
    const isTabletop = useStore((state) => state.view.mode === 'tabletop') && isXR;

    return(
        <>
            {/* Only VR */}
            { isVR && <color args={["rgb(42, 66, 165)"]} attach="background"/> }

            {/* ----------- ROOM + OBJECTS ---------------- */}
            {/* Room: VR / flatscreen, and in AR only as a miniature (at 1:1 the real room is used) */}
            <Board isTabletop={isTabletop} room={(!isAR || isTabletop) && <Room sizes={[6, 6]}/>}>
                <ObjectRenderer isTabletop={isTabletop} />
            </Board>

            {/* VR || AR: commands on the left wrist */}
            {isXR && <WristMenu />}
            {/* VR || AR: left hand open -> fist deletes the selected object */}
            {isXR && <FistDeleteGesture />}
            {/* VR || AR: right hand thumb-middle pinch + wrist twist rotates the selected object in place */}
            {isXR && <PinchRotateGesture />}

        </>
    );
}
