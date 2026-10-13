import './ui.css'
import CircleButton from './circle-button/CircleButton';
import { svg } from '../../utils/svg-logos';
import { useStore } from '../../store/appStore';
import { useState } from 'react';
import ObjectsMenu from './objects-menu/ObjectsMenu';
import { enterXR, useXRModeSupported } from '../../xr/xrStore';
import SnapControl from './snap-control/SnapControl';
import { isLockedByOther } from '../../sync/presence';
import { GRID_SNAP_STEPS, ROTATION_SNAP_STEPS } from '../../store/slices/settingSlice';


export default function RightToolBar() {
    
    const [objectsMenuOpen, setObjectsMenuOpen] = useState(false); // track objects menu state (open/close)

    const toggleGrid = useStore(state => state.toggleGrid);
    const selectedObject = useStore(state => state.objects.selectedId);
    const removeSelectedObject = useStore(state => state.removeObject);
    const settings = useStore(state => state.settings);
    const toggleGridSnap = useStore(state => state.toggleGridSnap);
    const setGridSnapStep = useStore(state => state.setGridSnapStep);
    const toggleRotationSnap = useStore(state => state.toggleRotationSnap);
    const setRotationSnapStep = useStore(state => state.setRotationSnapStep);
    // VR/AR buttons enabled only when the browser can actually start that session (headset browser, or a
    // PC with a headset connected via Link/SteamVR)
    const isVRSupported = useXRModeSupported('immersive-vr');
    const isARSupported = useXRModeSupported('immersive-ar');

    // svg logos
    const { fullscreenMode, arMode, vrMode } = svg;

    // function to allow player to enlarge to full screen visualization on computer
    const toggleFullScreen = () => {
        const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement
        
        if (!fullscreenElement) {
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen()
            } else if (document.documentElement.webkitRequestFullscreen) {
                document.documentElement.webkitRequestFullscreen()
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    };

    return(
        <>
            <div className="right-toolbar">
                {/* Grid and, under it, the snap controls (position grid, rotation) */}
                <div className="grid-tools">
                    <CircleButton svg={svg.grid} onClick={toggleGrid} title={"Grid"}/>
                    <SnapControl
                        icon={svg.gridSnap}
                        label="Grid snap"
                        unit=" cm"
                        enabled={settings.gridSnap}
                        step={settings.gridSnapStep}
                        steps={GRID_SNAP_STEPS}
                        onToggle={toggleGridSnap}
                        onPick={setGridSnapStep}
                    />
                    <SnapControl
                        icon={svg.rotationSnap}
                        label="Rotation snap"
                        unit="°"
                        enabled={settings.rotationSnap}
                        step={settings.rotationSnapStep}
                        steps={ROTATION_SNAP_STEPS}
                        onToggle={toggleRotationSnap}
                        onPick={setRotationSnapStep}
                    />
                </div>

                <div className='objects-selection'>
                    {/* orange "+" (same orange as the snap step buttons) */}
                    <CircleButton svg={svg.add} onClick={() => setObjectsMenuOpen(!objectsMenuOpen)} title={"Add"} style={{ color: '#ff9a1a' }}/>
                    { selectedObject && <CircleButton svg={svg.trash} style={{background: "linear-gradient(35deg, rgba(255, 0, 0, 1) 0%, rgba(203, 0, 0, 0.56) 60%)"}} onClick={() => { if (!isLockedByOther(selectedObject)) removeSelectedObject(selectedObject); }} title={"Delete selected object"}/> }
                    { objectsMenuOpen && (<ObjectsMenu onClose={() => setObjectsMenuOpen(false)}/>) }
                </div>
                
                <div className="experience-mode">
                    <CircleButton svg={vrMode} onClick={() => enterXR('immersive-vr').catch(console.error)} isDisabled={!isVRSupported} title={isVRSupported ? "VR Mode" : "VR not available: open in the headset browser, or connect a headset (Windows + Link)"}/>
                    <CircleButton svg={arMode} onClick={() => enterXR('immersive-ar').catch(console.error)} isDisabled={!isARSupported} title={isARSupported ? "AR Mode" : "AR not available on this device"}/>
                    <CircleButton svg={fullscreenMode} onClick={toggleFullScreen} title={"Fullscreen"} />
                </div>
            </div>
            
        </>
        
    );
}



