import './scene.css'
import Light from '../light/Light';
import Level from './level/Level';
import { WebGPURenderer } from 'three/webgpu';
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from '@react-three/drei';
import SceneGrid from './helpers/SceneGrid';
import { XR, PointerEvents, noEvents } from "@react-three/xr";
import { useStore } from '../../store/appStore';
import PerfSampler from './perf/PerfSampler';

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
    const isPerfVisible = useStore((state) => state.settings.perfVisibility);
    const deselectObject = useStore((state) => state.deselectObject);
    

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
                onPointerMissed={deselectObject}
                events={noEvents} // pmndrs pointer events (below) replace R3F's: one event system for mouse, touch, controllers and hands
            >
                {/* batchEvents={false}: handlers run inside the DOM event. Registered before OrbitControls,
                    so an object/gizmo press can disable orbiting before OrbitControls sees the same press */}
                <PointerEvents batchEvents={false} />

                {/* Performance stats for the DOM panel (both renderers) */}
                {isPerfVisible && <PerfSampler />}

                <OrbitControls 
                    makeDefault 
                    enableDamping
                    dampingFactor={ .2 }
                    maxPolarAngle={ Math.PI/2 }
                    minDistance={ 2 }
                    maxDistance={ 20 }
                />

                <XR store={xrStore}>
                    <SceneGrid visible={isGridVisible} />
                    <Light />
                    <Level />
                </XR>
            
            </Canvas>
        </div>
        </>
    );
}