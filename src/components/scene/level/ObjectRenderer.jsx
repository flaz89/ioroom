import { useStore } from "../../../store/appStore"
import { useXR } from "@react-three/xr"
import SingleObject from "./SingleObject";
import ObjectGhost from "./ObjectGhost";

// component used to load all models inside the level and track all them

export default function ObjectRenderer({ isTabletop }) {

    const instances = useStore((state) => state.objects.instances)
    const notes = useStore((state) => state.notes.items)
    
    const { mode } = useXR();
    const isVR = mode === "immersive-vr";
    const isAR = mode === "immersive-ar";
    const isFlatscreen = !isVR && !isAR;
    // builder (flatscreen only, admin): furniture frozen as holograms (ObjectGhost.jsx), not editable
    const isBuilder = useStore((state) => state.workspace === 'builder') && isFlatscreen;

    if (isBuilder) return instances.map((obj) => <ObjectGhost key={obj.id} data={obj} />);

    return(
    <>
        {instances.map((obj) => {
            return <SingleObject
                key={obj.id}
                data={obj}
                // post-it notes stuck on this object (they move with it)
                notes={notes.filter((note) => note.objectId === obj.id)}
                showPivot={isFlatscreen}
                // flatscreen: no rotation from a mouse ray; tabletop: pieces stay upright (yaw only)
                pointerRotation={isFlatscreen ? 'none' : isTabletop ? 'yaw' : 'free'}
                // dotted drag footprint on NEAR grabs too (hand/grip touching the object): flatscreen and
                // tabletop only, at 1:1 in a headset the object is right in the hand. Ray drags always show it.
                nearGrabFootprint={isFlatscreen || isTabletop}
            />
        })}
    </>
    );
}