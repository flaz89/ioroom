import './scene.css'
import Light from '../light/Light';
import Level from './level/Level';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from '@react-three/drei';
import { XR } from "@react-three/xr";
import { useStore } from '../../store/appStore';
import { Perf } from 'r3f-perf';

/* 
* This component is the orchestrator of all 3D environement, all the 3D objects needed in XR experience are 
* istanciated inside <XR> which recive "xrStore" passed from <App> in order to manage all the immersive 
* expereience and update the session
*/


export default function Scene({xrStore}) {

    const isWebGPUsupported = WebGPU.isAvailable();
    console.log("WebGPU support: " + isWebGPUsupported);

    const isGridVisible = useStore((state) => state.grid.visible);
    const isPerfVisible = useStore((state) => state.settings.perfVisibility);
    const deselectObject = useStore((state) => state.deselectObject);
    

    return(
        <>
        <div className="scene">
            <Canvas 
                camera={{
                    position: [4,3,7],
                    fov: 50
                }}
                dpr={ [1, 2] }
                shadows
                onPointerMissed={deselectObject}
            >
                {isPerfVisible && <Perf 
                            className='performance-menu' 
                            position='bottom-right' 
                            showGraph={false}
                        />  
                }

                <OrbitControls 
                    makeDefault 
                    enableDamping
                    dampingFactor={ .2 }
                    maxPolarAngle={ Math.PI/2 }
                    minDistance={ 2 }
                    maxDistance={ 20 }
                />

                <XR store={xrStore}>
                    <Grid 
                        args={[20, 20]} 
                        cellSize={.5}
                        cellThickness={.5}
                        cellColor="#555555"
                        sectionSize={2}
                        sectionThickness={1}
                        sectionColor="#888888"
                        fadeDistance={25}
                        fadeStrength={1}
                        followCamera={false}
                        infiniteGrid={false}
                        visible={isGridVisible}
                    />
                    <Light />
                    <Level />
                </XR>
            
            </Canvas>
        </div>
        </>
    );
}