import { useEffect, useMemo, useState } from 'react';
import { BufferGeometry, Float32BufferAttribute, PlaneGeometry, SRGBColorSpace, TextureLoader } from 'three';
import { useUnderlayVectors } from '../../../../plan/underlayFile';

const UNDERLAY_HEIGHT = 0.002; // meters above the floor level (no z-fighting with the ground grid)

/*
* The floor plan UNDERLAY (planModel.js level.underlay) lying on the floor of the 3D builder view, in place
* of the floors (Room.jsx hides them while it is shown): the same image, size, position and rotation as in
* the 2D plan, at this device's opacity. Unlit (a drawing, not a surface): no shadows, no tone mapping.
* The texture is loaded without Suspense (the room renders at once; the plane appears when ready).
* Inside the room group: the ruler can measure on it; a click on it selects nothing.
* A DXF underlay (kind 'dxf') is drawn as its lines instead (UnderlayLines).
*/
export default function UnderlayPlane({ underlay, opacity }) {
    return underlay.kind === 'dxf' ? <UnderlayLines underlay={underlay} opacity={opacity} /> : <UnderlayImage underlay={underlay} opacity={opacity} />;
}

function UnderlayImage({ underlay, opacity }) {
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

/*
* DXF underlay: the visible layers' segments (drawing units, centered) as one line set on the floor, placed
* like the image: scaled by metersPerPixel (meters per unit), turned, moved onto underlay.center.
* Dark lines: they lie on the (light) floors, which stay visible under a DXF (Room.jsx).
* ponytail: 1 px lines (WebGL / WebXR have no thick lines); fat lines (Line2) if they read too thin in VR.
*/
const noRaycast = () => null;

function UnderlayLines({ underlay, opacity }) {
    const layers = useUnderlayVectors(underlay);
    const hiddenKey = (underlay.hiddenLayers ?? []).join('\n');
    const geometry = useMemo(() => {
        if (layers == null) return null;
        const hidden = new Set(hiddenKey.split('\n'));
        const positions = [];
        for (const { name, segments } of layers) {
            if (hidden.has(name)) continue;
            for (let i = 0; i < segments.length; i += 2) positions.push(segments[i], 0, segments[i + 1]);
        }
        return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3));
    }, [layers, hiddenKey]);
    useEffect(() => () => geometry?.dispose(), [geometry]);

    if (geometry == null) return null;
    const mpp = underlay.metersPerPixel;
    return (
        <lineSegments
            geometry={geometry}
            position={[underlay.center[0], UNDERLAY_HEIGHT, underlay.center[1]]}
            rotation-y={-underlay.rotation}
            scale={[mpp, 1, mpp]}
            raycast={noRaycast} // lines hit within a 1 m threshold by default: they would steal the clicks
        >
            <lineBasicMaterial color="#1c2a78" transparent opacity={opacity} depthWrite={false} toneMapped={false} />
        </lineSegments>
    );
}
