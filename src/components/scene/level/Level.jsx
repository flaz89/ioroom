import { useXR } from "@react-three/xr";
import { createPortal, useThree } from "@react-three/fiber";
import Room from "./room/Room";
import Board from "./Board";
import ObjectRenderer from "./ObjectRenderer";
import WristMenu from "../xr-ui/WristMenu";
import FistDeleteGesture from "../xr-ui/FistDeleteGesture";
import RemotePointers from "../presence/RemotePointers";
import RemoteAvatars from "../presence/RemoteAvatars";
import PinchRotateGesture from "../xr-ui/PinchRotateGesture";
import TeleportGesture from "../xr-ui/TeleportGesture";
import VRSunPanel from "../xr-ui/VRSunPanel";
import VRNotePanel from "../xr-ui/VRNotePanel";
import VRMaterialsPanel from "../xr-ui/VRMaterialsPanel";
import VRMeasurePanel from "../xr-ui/VRMeasurePanel";
import { useStore } from "../../../store/appStore";
import Light from "../../light/Light";
import { CameraHeadingTracker } from "../sun/CameraHeadingTracker";
import CompassLetters from "../sun/CompassLetters";
import BoardNotes from "../notes/Notes";
import BoardMeasures from "../measure/Measures";
import MaterialDropTarget from "./room/MaterialDropTarget";

export default function Level() {

    const { mode } = useXR();
    const isVR = mode === "immersive-vr"
    const isAR = mode === "immersive-ar"
    const isXR = isVR || isAR;
    const scene = useThree((state) => state.scene);
    // Tabletop (miniature) view exists only inside XR sessions
    const isTabletop = useStore((state) => state.view.mode === 'tabletop') && isXR;
    const isSunPanelOpen = useStore((state) => state.openPanel === 'sun');
    const isMaterialsPanelOpen = useStore((state) => state.openPanel === 'materials');

    return(
        <>
            {/* Only VR. Portaled into the scene: Level sits inside a <group> (Scene.jsx), and attach="background"
                attaches to the PARENT, so without the portal it would set group.background (ignored) */}
            { isVR && createPortal(<color args={["rgb(42, 66, 165)"]} attach="background"/>, scene) }

            {/* ----------- ROOM + OBJECTS ---------------- */}
            {/* Room: VR / flatscreen, and in AR only as a miniature (at 1:1 the real room is used) */}
            <Board isTabletop={isTabletop} room={(!isAR || isTabletop) && <Room />}>
                {/* Sun + ambient: inside the board, so light, sun arc and shadows follow the tabletop model */}
                <Light />
                {/* Compass: view direction in board space (compass bars), N/E/S/W on the floor around the room */}
                <CameraHeadingTracker />
                <CompassLetters />
                <ObjectRenderer isTabletop={isTabletop} />
                {/* post-it notes on room surfaces + desktop placing mode (notes on objects: SingleObject) */}
                <BoardNotes />
                {/* ruler: measures (mine temporary, saved shared) + desktop ruler mode */}
                <BoardMeasures />
                {/* desktop/mobile: drop target of the materials panel (drag a material onto a wall/floor) */}
                {!isXR && <MaterialDropTarget />}
                {/* shared rooms: other people's pointers (and this device's, published) */}
                <RemotePointers />
                {/* shared rooms: headset users (and this headset, published) */}
                <RemoteAvatars />
            </Board>

            {/* VR || AR: commands on the left wrist */}
            {isXR && <WristMenu />}
            {/* VR || AR: sun settings panel, opened from the wrist menu; world space, in front of the user */}
            {isXR && isSunPanelOpen && <VRSunPanel />}
            {/* VR || AR: materials panel (wrist button), drag a ball with the ray onto a floor/wall face */}
            {isXR && isMaterialsPanelOpen && <VRMaterialsPanel />}
            {/* VR || AR: actions of the selected ruler measure (Save / Delete) */}
            {isXR && <VRMeasurePanel />}
            {/* VR || AR: post-it editor (open note or new one), world space, in front of the user */}
            {isXR && <VRNotePanel />}
            {/* VR || AR: left hand open -> fist deletes the selected object */}
            {isXR && <FistDeleteGesture />}
            {/* VR || AR: right hand thumb-middle pinch + wrist twist rotates the selected object in place */}
            {isXR && <PinchRotateGesture />}
            {/* VR life mode only: left hand pinch, aim the arc, release = teleport */}
            {isVR && !isTabletop && <TeleportGesture />}

        </>
    );
}
