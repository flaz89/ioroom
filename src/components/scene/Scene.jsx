import { OrbitControls } from '@react-three/drei';
import { Canvas } from "@react-three/fiber";
import { XR } from "@react-three/xr";
import './scene.css'
import Light from '../light/Light';

export default function Scene({xrStore}) {
        


    return(
        <>
        <div className="scene">
            <Canvas camera={{
                            position: [5,5,5],
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
                    {/* <color args={["rgba(42, 66, 165, 1)"]} attach="background"/> */}
                    <Light />
                    <mesh>
                        <boxGeometry />
                        <meshNormalMaterial />
                    </mesh>
                </XR>
            
            </Canvas>
        </div>
        </>
    );
}