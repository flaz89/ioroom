import './ui.css'
import CircleButton from './circle-button/CircleButton';
import { svg } from '../../utils/svg-logos';
import { useStore } from '../../store/appStore';
import ObjectsMenu from './objects-menu/ObjectsMenu';
import { enterXR, useXRModeSupported } from '../../xr/xrStore';
import SnapControl from './snap-control/SnapControl';
import { isLockedByOther } from '../../sync/presence';
import { GRID_SNAP_STEPS, ROTATION_SNAP_STEPS } from '../../store/slices/settingSlice';


export default function RightToolBar() {
    
    // Objects menu open state, shared with the other toolbar panels: only one open at a time (store/slices/panelSlice.js)
    const objectsMenuOpen = useStore(state => state.openPanel === 'objects');
    const togglePanel = useStore(state => state.togglePanel);
    const closePanel = useStore(state => state.closePanel);

    const toggleGrid = useStore(state => state.toggleGrid);
    // post-it placing mode: the next press on a surface sticks a note there (scene/notes/Notes.jsx)
    const isPlacingNote = useStore(state => state.notes.placing);
    // ruler mode: clicks place measure points (scene/measure/Measures.jsx)
    const isMeasuring = useStore(state => state.measures.active);
    const setMeasuring = useStore(state => state.setMeasuring);
    const setPlacingNote = useStore(state => state.setPlacingNote);
    const selectedObject = useStore(state => state.objects.selectedId);
    const removeSelectedObject = useStore(state => state.removeObject);
    const settings = useStore(state => state.settings);
    const toggleGridSnap = useStore(state => state.toggleGridSnap);
    const setGridSnapStep = useStore(state => state.setGridSnapStep);
    const toggleRotationSnap = useStore(state => state.toggleRotationSnap);
    const setRotationSnapStep = useStore(state => state.setRotationSnapStep);
    // Furniture and post-its belong to the designer mode (store/slices/workspaceSlice.js)
    const isDesigner = useStore(state => state.workspace === 'designer');
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
                    <CircleButton svg={svg.ruler} onClick={() => setMeasuring(!isMeasuring)} isActive={isMeasuring} title={isMeasuring ? "Click two points to measure (Esc to stop)" : "Measure"}/>
                    {isDesigner && <CircleButton svg={svg.note} onClick={() => setPlacingNote(!isPlacingNote)} isActive={isPlacingNote} title={isPlacingNote ? "Click a wall or an object to stick the note (Esc to cancel)" : "Add a note"}/>}
                </div>

                {isDesigner && <div className='objects-selection'>
                    {/* orange "+" (same orange as the snap step buttons) */}
                    <CircleButton svg={svg.add} onClick={() => togglePanel('objects')} title={"Add"} isActive={objectsMenuOpen} style={objectsMenuOpen ? undefined : { color: '#ff9a1a' }}/>
                    { selectedObject && <CircleButton svg={svg.trash} style={{background: "linear-gradient(35deg, rgba(255, 0, 0, 1) 0%, rgba(203, 0, 0, 0.56) 60%)"}} onClick={() => { if (!isLockedByOther(selectedObject)) removeSelectedObject(selectedObject); }} title={"Delete selected object"}/> }
                    { objectsMenuOpen && (<ObjectsMenu onClose={closePanel}/>) }
                </div>}
                
                <div className="experience-mode">
                    <CircleButton svg={vrMode} onClick={() => enterXR('immersive-vr').catch(console.error)} isDisabled={!isVRSupported} title={isVRSupported ? "VR Mode" : "VR not available: open in the headset browser, or connect a headset (Windows + Link)"}/>
                    <CircleButton svg={arMode} onClick={() => enterXR('immersive-ar').catch(console.error)} isDisabled={!isARSupported} title={isARSupported ? "AR Mode" : "AR not available on this device"}/>
                    <CircleButton svg={fullscreenMode} onClick={toggleFullScreen} title={"Fullscreen"} />
                </div>
            </div>
            
        </>
        
    );
}



