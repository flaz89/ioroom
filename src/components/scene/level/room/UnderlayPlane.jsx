import { useEffect, useMemo, useState } from 'react';
import { PlaneGeometry, SRGBColorSpace, TextureLoader } from 'three';

const UNDERLAY_HEIGHT = 0.002; // meters above the floor level (no z-fighting with the ground grid)

/*
* The floor plan UNDERLAY (planModel.js level.underlay) lying on the floor of the 3D builder view, in place
* of the floors (Room.jsx hides them while it is shown): the same image, size, position and rotation as in
* the 2D plan, at this device's opacity. Unlit (a drawing, not a surface): no shadows, no tone mapping.
* The texture is loaded without Suspense (the room renders at once; the plane appears when ready).
* Inside the room group: the ruler can measure on it; a click on it selects nothing.
*/
export default function UnderlayPlane({ underlay, opacity }) {
    const [texture, setTexture] = useState(null);
    useEffect(() => {
        let alive = true;
        let loaded = null;
        new TextureLoader().load(underlay.url, (result) => {
            result.colorSpace = SRGBColorSpace;
            result.anisotropy = 4; // seen at grazing angles: keeps the lines readable
            loaded = result;
            if (alive) setTexture(result);
            else result.dispose();
        });
        return () => {
            alive = false;
            loaded?.dispose();
        };
    }, [underlay.url]);

    // Plane of the image's real size; the geometry faces +Z: turned to face up, image top towards -Z
    // (the top of the 2D plan)
    const w = underlay.width * underlay.metersPerPixel;
    const h = underlay.height * underlay.metersPerPixel;
    const geometry = useMemo(() => new PlaneGeometry(w, h).rotateX(-Math.PI / 2), [w, h]);
    useEffect(() => () => geometry.dispose(), [geometry]);

    if (texture == null) return null;
    return (
        // 2D rotation is clockwise on screen (x right, z down) = a negative turn around +Y
        <mesh geometry={geometry} position={[underlay.center[0], UNDERLAY_HEIGHT, underlay.center[1]]} rotation-y={-underlay.rotation}>
            <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
        </mesh>
    );
}
