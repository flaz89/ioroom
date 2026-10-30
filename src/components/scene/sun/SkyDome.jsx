import { useEffect, useMemo } from 'react';
import { BackSide, BufferAttribute, Color, SphereGeometry } from 'three';
import { useXR } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { sunLighting } from './sunLighting';
import { skyColor } from './sky';

/*
* SKY in VR (immersive-vr only): what is seen out of the windows and over the walls, colored by the sun (sky.js:
* city, day and time of the sun panel). Before, the empty background read as a flat saturated blue. Not in AR
* (the real room shows through) nor on screen (the app's own background).
* A big inward sphere with vertex colors, rebuilt when the sun settings change (~1200 vertices): no custom
* shader, so WebGPU-safe too. Drawn first (renderOrder) without depth writes: everything else covers it; never
* hit by pointers (a ray would rest its cursor on the sky).
* ponytail: world space, so in the tabletop view the glow does not turn with a rotated board; the sky's own
* direction-to-sun is the 1:1 room's.
*/
const RADIUS = 400; // meters, inside the camera's far plane (1000)
const noRaycast = () => {};

export default function SkyDome() {
    const isVR = useXR((state) => state.mode === 'immersive-vr');
    return isVR ? <Dome /> : null;
}

function Dome() {
    const sun = useStore((state) => state.sun);
    // rebuilt when the sun settings change (also while the time slider moves: ~1200 vertices, cheap)
    const geometry = useMemo(() => {
        const sphere = new SphereGeometry(RADIUS, 48, 24);
        const { direction, altitude } = sunLighting(sun);
        const position = sphere.attributes.position;
        const colors = new Float32Array(position.count * 3);
        const color = new Color();
        for (let i = 0; i < position.count; i++) {
            skyColor([position.getX(i) / RADIUS, position.getY(i) / RADIUS, position.getZ(i) / RADIUS], direction, altitude, color);
            color.toArray(colors, i * 3);
        }
        sphere.setAttribute('color', new BufferAttribute(colors, 3));
        return sphere;
    }, [sun]);
    useEffect(() => () => geometry.dispose(), [geometry]);

    return (
        <mesh geometry={geometry} raycast={noRaycast} pointerEvents="none" frustumCulled={false} renderOrder={-10}>
            <meshBasicMaterial vertexColors side={BackSide} depthWrite={false} toneMapped={false} fog={false} />
        </mesh>
    );
}
