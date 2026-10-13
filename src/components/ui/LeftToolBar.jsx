import CircleButton from "./circle-button/CircleButton";
import { svg } from "../../utils/svg-logos";
import { useStore } from "../../store/appStore";
import SharePanel from "./share-panel/SharePanel";
import RoomUsers from "./room-users/RoomUsers";
import { SYNC_HOST } from "../../sync/roomSync";

export default function LeftToolBar() {

    const togglePerf = useStore((state) => state.togglePerf);

    // svg logos
    const { settingsMenu, performance } = svg;

    return(
    <>
        <div className="left-toolbar">
            {/* top: people in the shared room (wrapper always rendered: keeps the settings at the bottom) */}
            <div><RoomUsers /></div>

            <div className="scene-settings">
                <CircleButton svg={settingsMenu}/>
                <CircleButton svg={performance} onClick={togglePerf} title={"Performance"}/>
                {/* shared rooms only (VITE_SYNC_HOST configured) */}
                {SYNC_HOST && <SharePanel />}
            </div>
            
        </div>
    </>
    );
}
