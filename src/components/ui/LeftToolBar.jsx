import CircleButton from "./circle-button/CircleButton";
import { svg } from "../../utils/svg-logos";
import { useStore } from "../../store/appStore";
import SharePanel from "./share-panel/SharePanel";
import { SYNC_HOST } from "../../sync/roomSync";

export default function LeftToolBar() {

    const togglePerf = useStore((state) => state.togglePerf);

    // svg logos
    const { settingsMenu, performance } = svg;

    return(
    <>
        <div className="left-toolbar">
            <div></div>

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
