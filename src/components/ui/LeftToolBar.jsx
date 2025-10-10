import CircleButton from "./circle-button/CircleButton";
import { svg } from "../../utils/svg-logos";
import { useStore } from "../../store/appStore";

export default function LeftToolBar() {

    const togglePerf = useStore((state) => state.togglePerf);

    // svg logos
    const { settingsMenu ,performance } = svg;

    return(
    <>
        <div className="left-toolbar">
            <div></div>

            <div className="scene-settings">
                <CircleButton svg={settingsMenu}/>
                <CircleButton svg={performance} onClick={togglePerf} title={"Performance"}/>
            </div>
            
        </div>
    </>
    );
}