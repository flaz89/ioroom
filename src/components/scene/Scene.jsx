import './scene.css'
import { Canvas } from "@react-three/fiber";
import { XR } from "@react-three/xr";

export default function Scene({xrStore}) {

    return(
        <>
        <div className="scene">
            <Canvas>

                <XR store={xrStore}>
                   
                </XR>
            
            </Canvas>
        </div>
        </>
    );
}