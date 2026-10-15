import CircleButton from "./circle-button/CircleButton";
import { svg } from "../../utils/svg-logos";
import { useStore } from "../../store/appStore";
import SharePanel from "./share-panel/SharePanel";
import RoomsPanel from "./rooms-panel/RoomsPanel";
import SunPanel from "./sun-panel/SunPanel";
import MaterialsPanel from "./materials-panel/MaterialsPanel";
import RoomUsers from "./room-users/RoomUsers";
import { SYNC_HOST, isAdmin } from "../../sync/roomSync";

export default function LeftToolBar() {

    // Performance stats: one of the toolbar panels (only one open at a time, store/slices/panelSlice.js)
    const isPerfVisible = useStore((state) => state.openPanel === 'perf');
    const togglePanel = useStore((state) => state.togglePanel);

    // svg logos
    const { settingsMenu, performance } = svg;

    return(
    <>
        <div className="left-toolbar">
            {/* top: people in the shared room (wrapper always rendered: keeps the settings at the bottom) */}
            <div><RoomUsers /></div>

            <div className="scene-settings">
                <CircleButton svg={settingsMenu}/>
                {/* not last: its panel is centered on the button and needs room below it */}
                <SunPanel />
                {/* room surface materials (floor, walls) */}
                <MaterialsPanel />
                {/* shared rooms, owner only for now (guests must not spread new rooms) */}
                {SYNC_HOST && isAdmin && <RoomsPanel />}
                {/* second to last */}
                <CircleButton svg={performance} onClick={() => togglePanel('perf')} isActive={isPerfVisible} title={"Performance"}/>
                {SYNC_HOST && isAdmin && <SharePanel />}
            </div>
            
        </div>
    </>
    );
}
