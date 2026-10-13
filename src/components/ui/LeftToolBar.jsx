import CircleButton from "./circle-button/CircleButton";
import { svg } from "../../utils/svg-logos";
import { useStore } from "../../store/appStore";

export default function LeftToolBar() {

    const togglePerf = useStore((state) => state.togglePerf);
    const gridSnap = useStore((state) => state.settings.gridSnap);
    const toggleGridSnap = useStore((state) => state.toggleGridSnap);

    // svg logos
    const { settingsMenu, performance, gridSnap: gridSnapIcon } = svg;

    return(
    <>
        <div className="left-toolbar">
            <div></div>

            <div className="scene-settings">
                <CircleButton svg={settingsMenu}/>
                <CircleButton svg={performance} onClick={togglePerf} title={"Performance"}/>
                <CircleButton
                    svg={gridSnapIcon}
                    onClick={toggleGridSnap}
                    title={gridSnap ? "Grid snap: on" : "Grid snap: off"}
                    style={gridSnap ? { outline: '2px solid orange', outlineOffset: '-2px' } : undefined}
                />
            </div>
            
        </div>
    </>
    );
}