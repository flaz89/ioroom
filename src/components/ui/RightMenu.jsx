import './ui.css'
import CircleButton from './circle-button/CircleButton';
import { svg } from '../../utils/svg-logos';
import { useStore } from '../../store/appStore';




export default function RightMenu({xrStore}) {

    const toggleGrid = useStore( state => state.toggleGrid);

    // svg logos
    const { fullscreen, ar, vr } = svg;

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
            <div className="right-menu">
                <div>
                    <CircleButton svg={svg.grid} onClick={toggleGrid} title={"Grid"}/>
                </div>
                <div className="experience-mode">
                    <CircleButton svg={vr} onClick={() => {xrStore.enterVR()}} title={"VR Mode"}/>
                    <CircleButton svg={ar} onClick={() => {xrStore.enterAR()}} title={"AR Mode"}/>
                    <CircleButton svg={fullscreen} onClick={toggleFullScreen} title={"Fullscreen"} />
                </div>
            </div>
            
        </>
        
    );
}



