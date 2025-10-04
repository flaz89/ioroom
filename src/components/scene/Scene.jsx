import { OrbitControls, Grid } from '@react-three/drei';
import { Canvas } from "@react-three/fiber";
import { XR } from "@react-three/xr";
import './scene.css'
import Light from '../light/Light';
import Level from './level/Level';

/* 
* This component is the orchestrator of all 3D environement, all the 3D objects needed in XR experience are 
* istanciated inside <XR> which recive "xrStore" passed from <App> in order to manage all the immersive 
* expereience and update the session
*/

export default function Scene({xrStore}) {

    return(
        <>
        <div className="scene">
            <Canvas camera={{
                        position: [4,3,7],
                        fov: 50
                    }}
                    dpr={ [1, 2] }
                    shadows
            >
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
                        visible={true}
                    />
                    <Light />
                    <Level />
                </XR>
            
            </Canvas>
        </div>
        </>
    );
}