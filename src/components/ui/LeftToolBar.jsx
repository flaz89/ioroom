import CircleButton from "./circle-button/CircleButton";
import { svg } from "../../utils/svg-logos";
import { useStore } from "../../store/appStore";
import SharePanel from "./share-panel/SharePanel";
import RoomsPanel from "./rooms-panel/RoomsPanel";
import SunPanel from "./sun-panel/SunPanel";
import MaterialsPanel from "./materials-panel/MaterialsPanel";
import BillPanel from "./bill-panel/BillPanel";
import RoomUsers from "./room-users/RoomUsers";
import { SYNC_HOST, isAdmin } from "../../sync/roomSync";

export default function LeftToolBar() {

    // Performance stats: stays open alongside the other panels (closes them only on phones, panelSlice.js)
    const isPerfVisible = useStore((state) => state.perfOpen);
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
                {/* not last: its panel is centered on the button and needs room below it */}
                <SunPanel />
                {/* room surface materials (floor, walls) */}
                <MaterialsPanel />
                {/* bill of quantities of the materials in use (everyone, for now) */}
                <BillPanel />
                {/* shared rooms, owner only for now (guests must not spread new rooms) */}
                {SYNC_HOST && isAdmin && <RoomsPanel />}
                {/* second to last */}
                <CircleButton svg={performance} onClick={togglePerf} isActive={isPerfVisible} title={"Performance"}/>
                {SYNC_HOST && isAdmin && <SharePanel />}
            </div>
            
        </div>
    </>
    );
}
