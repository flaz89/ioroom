import './ui.css'
import CircleButton from './circle-button/CircleButton';
import { svg } from '../../utils/svg-logos';
import { useStore } from '../../store/appStore';
import { useState } from 'react';
import ObjectsMenu from './objects-menu/ObjectsMenu';


export default function RightToolBar({xrStore}) {
    
    const [objectsMenuOpen, setObjectsMenuOpen] = useState(false); // track objects menu state (open/close)

    const toggleGrid = useStore(state => state.toggleGrid);
    const selectedObject = useStore(state => state.objects.selectedId);
    const removeSelectedObject = useStore(state => state.removeObject);

    // svg logos
    const { fullscreenMode, arMode, vrMode } = svg;

    // function to allow player to enlarge to full screen visualization on computer
    const toggleFullScreen = () => {
        const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement
        
        if (!fullscreenElement) {
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen()
            } else if (document.documentElement.webkitRequestFullscreen) {
                document.documentElement.requestFullscreen()
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullScreen) {
                document.webkitExitFullscreen();
            }
        }
    };

    return(
        <>
            <div className="right-toolbar">
                <div><CircleButton svg={svg.grid} onClick={toggleGrid} title={"Grid"}/></div>

                <div className='objects-selection'>
                    <CircleButton svg={svg.add} onClick={() => setObjectsMenuOpen(!objectsMenuOpen)} title={"Add"}/>
                    { selectedObject && <CircleButton svg={svg.trash} style={{background: "linear-gradient(35deg, rgba(255, 0, 0, 1) 0%, rgba(203, 0, 0, 0.56) 60%)"}} onClick={() => {removeSelectedObject(selectedObject) }} title={"Delete selected object"}/> }
                    { objectsMenuOpen && (<ObjectsMenu onClose={() => setObjectsMenuOpen(false)}/>) }
                </div>
                
                <div className="experience-mode">
                    <CircleButton svg={vrMode} onClick={() => {xrStore.enterVR()}} title={"VR Mode"}/>
                    <CircleButton svg={arMode} onClick={() => {xrStore.enterAR()}} title={"AR Mode"}/>
                    <CircleButton svg={fullscreenMode} onClick={toggleFullScreen} title={"Fullscreen"} />
                </div>
            </div>
            
        </>
        
    );
}



