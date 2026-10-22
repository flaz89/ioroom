import './scene.css'
import { useMemo, useRef, useState } from 'react';
import Level from './level/Level';
import { WebGPURenderer } from 'three/webgpu';
import { Canvas } from "@react-three/fiber";
import { CameraControls } from '@react-three/drei';
import CameraMemory from './controls/CameraMemory';
import SceneGrid from './helpers/SceneGrid';
import OrbitAtCursor from './controls/OrbitAtCursor';
import { activeLevel, sceneBounds } from '../../plan/planModel';
import { XR, PointerEvents, noEvents } from "@react-three/xr";
import { useStore } from '../../store/appStore';
import PerfSampler from './perf/PerfSampler';
import Wireframe from './perf/Wireframe';
import PlanView2D from '../builder/PlanView2D';
import WallPanel from '../builder/WallPanel';

/* 
* This component is the orchestrator of all 3D environement, all the 3D objects needed in XR experience are 
* istanciated inside <XR> which recive "xrStore" passed from <App> in order to manage all the immersive 
* expereience and update the session
*/


/*
* Async renderer factory for <Canvas gl>: WebGPURenderer must be initialized before the first frame.
* If no WebGPU adapter is available, three.js silently falls back to its WebGL2 backend, which does not
* support the GLSL shader materials used by some drei helpers: in that case switch to a plain WebGLRenderer.
*/
async function createWebGPURenderer(props) {
    // trackTimestamp: GPU frame time for the performance panel (ignored if 'timestamp-query' is unsupported)
    const renderer = new WebGPURenderer({ ...props, antialias: true, trackTimestamp: true });
    await renderer.init();
    if (!renderer.backend.isWebGPUBackend) useStore.getState().disableWebGPU();
    return renderer;
}

export default function Scene({xrStore}) {

    // "webgpu" on flatscreen when supported, "webgl" during XR sessions (see src/xr/xrStore.js)
    const backend = useStore((state) => state.renderer.backend);
    const setReadyBackend = useStore((state) => state.setReadyBackend);

    const isGridVisible = useStore((state) => state.grid.visible);
    // ZOOM-OUT LIMIT from the project's size (plan + underlay drawing): the whole of it fits in the view
    // (about 2.5 x its radius away), never less than the first versions' 20 m
    const level = useStore((state) => activeLevel(state.plan));
    const maxDistance = useMemo(() => Math.max(20, sceneBounds(level).radius * 2.5), [level]);
    const isPerfVisible = useStore((state) => state.perfOpen);
    const isWireframe = useStore((state) => state.wireframe);
    const deselectObject = useStore((state) => state.deselectObject);
    // builder mode, 2D view: the plan is drawn over the canvas (store/slices/workspaceSlice.js)
    const isPlanView = useStore((state) => state.workspace === 'builder' && state.builderView === '2d');
    const isBuilder = useStore((state) => state.workspace === 'builder');

    // CAMERA DRAG (orbit / pan / zoom with CameraControls): while the camera actually moves, the scene takes no
    // pointer events, so nothing gets hovered (no tint, no hand cursor) under a sweeping mouse.
    // 'start' alone is NOT enough: a plain click also starts the controls, and blocking events on press would
    // eat that click. So: armed on start, blocked on the first camera 'change', released on 'end' (the damping
    // changes after 'end' are ignored: not armed anymore).
    const [isOrbiting, setIsOrbiting] = useState(false);
    const orbitArmedRef = useRef(false);
    const onOrbitStart = () => { orbitArmedRef.current = true; };
    const onOrbitChange = () => { if (orbitArmedRef.current && !isOrbiting) setIsOrbiting(true); };
    const onOrbitEnd = () => { orbitArmedRef.current = false; setIsOrbiting(false); };
    // click on nothing: deselects the object, and the wall in the builder (3D view)
    const onPointerMissed = () => {
        deselectObject();
        useStore.getState().setSelectedWallId(null);
    };
    

    return(
        <>
        <div className="scene">
            <Canvas 
                key={backend} // a new backend needs a new canvas: a canvas can't switch context type
                gl={backend === 'webgpu' ? createWebGPURenderer : undefined}
                onCreated={() => setReadyBackend(backend)}
                camera={{
                    position: [4,3,7],
                    fov: 50
                }}
                dpr={ [1, 2] }
                shadows
                onPointerMissed={onPointerMissed}
                events={noEvents} // pmndrs pointer events (below) replace R3F's: one event system for mouse, touch, controllers and hands
            >
                {/* batchEvents={false}: handlers run inside the DOM event. Registered before CameraControls,
                    so an object/gizmo press can disable orbiting before CameraControls sees the same press */}
                <PointerEvents batchEvents={false} />

                {/* Performance stats for the DOM panel (both renderers) */}
                {isPerfVisible && <PerfSampler />}
                {/* Debug: whole scene in wireframe */}
                {isWireframe && <Wireframe />}

                {/* camera-controls (yomotsu): left = rotate, right = pan (truck), wheel / middle = zoom (dolly), all damped
                    (smoothTime); touch: one finger rotates, two zoom + pan. Never below the horizon. minDistance is
                    small because the orbit point follows the cursor (OrbitAtCursor.jsx): distances are to it.
                    dollyToCursor: the wheel / pinch zooms towards the spot under the pointer (like a CAD), not the
                    screen's center */}
                <CameraControls
                    makeDefault
                    smoothTime={ 0.2 }
                    maxPolarAngle={ Math.PI/2 }
                    minDistance={ 0.5 }
                    dollyToCursor
                    maxDistance={ maxDistance }
                    onStart={onOrbitStart}
                    onChange={onOrbitChange}
                    onEnd={onOrbitEnd}
                />
                {/* every rotation turns around the spot under the pointer */}
                <OrbitAtCursor />
                {/* each device reopens the environment where it left the view (localStorage) */}
                <CameraMemory />

                <XR store={xrStore}>
                    <SceneGrid visible={isGridVisible} />
                    {/* 'listener' is the pmndrs default; it must be explicit ('undefined' is ignored by R3F) */}
                    <group pointerEvents={isOrbiting ? 'none' : 'listener'}>
                        <Level />
                    </group>
                </XR>
            
            </Canvas>
            {isPlanView && <PlanView2D />}
            {/* selected wall panel, in both builder views (2D plan and 3D) */}
            {isBuilder && <WallPanel />}
        </div>
        </>
    );
}