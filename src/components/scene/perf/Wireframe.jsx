import { useEffect } from 'react';
import { MeshBasicMaterial } from 'three';
import { useThree } from '@react-three/fiber';

// One unlit wireframe material for everything: shows the real triangles of the scene (room, objects,
// hands, controllers, VR panels), on both renderers.
const WIREFRAME = new MeshBasicMaterial({ color: '#ff9a1a', wireframe: true, toneMapped: false });

/*
* Debug view (store `wireframe`, Settings > Wireframe and the VR wrist menu): while mounted, the WHOLE scene
* renders with WIREFRAME through scene.overrideMaterial (no traversal, objects added later are covered too).
* Note: WebGL counts wireframe draws as lines, so the Triangles stat drops while it is on.
*/
export default function Wireframe() {
    const getThree = useThree((state) => state.get);
    useEffect(() => {
        const scene = getThree().scene;
        scene.overrideMaterial = WIREFRAME;
        return () => { scene.overrideMaterial = null; };
    }, [getThree]);
    return null;
}
