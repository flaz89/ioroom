import { useStore } from "../../../store/appStore"
import { useXR } from "@react-three/xr"
import SingleObject from "./SingleObject";

// component used to load all models inside the level and track all them

export default function ObjectRenderer() {

    const instances = useStore((state) => state.objects.instances)
    
    const { mode } = useXR();
    const isVR = mode === "immersive-vr";
    const isAR = mode === "immersive-ar";
    const isFlatscreen = !isVR && !isAR;

    return(
    <>
        {instances.map((obj) => {
            return <SingleObject key={obj.id} data={obj} showPivot={isFlatscreen}/>
        })}
    </>
    );
}