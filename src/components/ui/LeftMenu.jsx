import CircleButton from "./circle-button/CircleButton";
import { svg } from "../../utils/svg-logos";
import { useStore } from "../../store/appStore";

export default function LeftMenu() {

    const togglePerf = useStore((state) => state.togglePerf);
    const addObject = useStore((state) => state.addObject )

    // svg logos
    const { settingsMenu ,performance } = svg;

    return(
    <>
        <div className="left-menu">
            <div>
                <CircleButton onClick={() => {addObject("sphere")}}/>
                <CircleButton onClick={() => {console.log(useStore.getState().objects.instances);
                }} />
            </div>
            <div className="scene-settings">
                <CircleButton svg={settingsMenu}/>
                <CircleButton svg={performance} onClick={togglePerf} title={"Performance"}/>
            </div>
            
        </div>
    </>
    );
}