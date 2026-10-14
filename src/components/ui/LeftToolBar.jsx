import CircleButton from "./circle-button/CircleButton";
import { svg } from "../../utils/svg-logos";
import { useStore } from "../../store/appStore";
import SharePanel from "./share-panel/SharePanel";
import RoomsPanel from "./rooms-panel/RoomsPanel";
import RoomUsers from "./room-users/RoomUsers";
import { SYNC_HOST, isAdmin } from "../../sync/roomSync";

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
                {/* shared rooms, owner only for now (guests must not spread new rooms) */}
                {SYNC_HOST && isAdmin && <RoomsPanel />}
                {SYNC_HOST && isAdmin && <SharePanel />}
            </div>
            
        </div>
    </>
    );
}
