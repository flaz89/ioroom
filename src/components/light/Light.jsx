import { useMemo, useRef, useState } from 'react';
import { Object3D, Vector3 } from 'three';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../../store/appStore';
import { sunLighting } from '../scene/sun/sunLighting';
import SunArc from '../scene/sun/SunArc';

const SUN_DISTANCE = 15;   // room meters from the room center
const SHADOW_HALF = 6;     // room meters: half side of the shadow camera (covers the 6x6 m room and its walls)
const SHADOW_NEAR = 0.5;   // room meters
const SHADOW_FAR = 30;     // room meters (> 2 x SUN_DISTANCE is not needed: the room is around the target)
const NORMAL_BIAS = 0.02;  // room meters: removes shadow acne on the walls/floor

const _scale = new Vector3();

/*
* Scene lights: an ambient light plus the sun, the only directional light (it casts the shadows).
* The sun follows the real solar arc of the environment's location, day and clock time (store `sun`,
* edited in the sun panel; values from sun/sunLighting.js); it fades out and turns warm near the horizon,
* and the ambient light dims at night. SunArc shows the sun's path while the day/time sliders move.
*
* Lives INSIDE the Board (level/Level.jsx): position, arc and shadows are in room units, so in tabletop
* mode they shrink, move and turn with the model. The shadow camera is sized in world units by three.js,
* so its frustum (and normal bias) is rescaled here whenever the board scale changes (two-hand zoom):
* the shadow map always covers just the room, as sharp in the miniature as at 1:1.
*/
export default function Light() {
    const sun = useStore((state) => state.sun);
    const lighting = useMemo(() => sunLighting(sun), [sun]);
    const lightRef = useRef();
    const appliedScale = useRef(0);
    // Target at the room center, inside the board so it follows it (a light's target must be in the scene)
    const [target] = useState(() => new Object3D());

    useFrame(() => {
        const light = lightRef.current;
        const scale = light.parent.getWorldScale(_scale).x; // board scale (uniform)
        if (Math.abs(scale - appliedScale.current) < 1e-6) return;
        appliedScale.current = scale;
        const camera = light.shadow.camera;
        camera.left = camera.bottom = -SHADOW_HALF * scale;
        camera.right = camera.top = SHADOW_HALF * scale;
        camera.near = SHADOW_NEAR * scale;
        camera.far = SHADOW_FAR * scale;
        camera.updateProjectionMatrix();
        light.shadow.normalBias = NORMAL_BIAS * scale;
    });

    return(
        <>
            <ambientLight intensity={lighting.ambient}/>

            <primitive object={target} />
            <directionalLight
                ref={lightRef}
                castShadow
                target={target}
                position={lighting.direction.map((value) => value * SUN_DISTANCE)}
                intensity={lighting.intensity}
                color={lighting.color}
                shadow-mapSize={[2048, 2048]}
            />

            <SunArc sun={sun} lighting={lighting} />
        </>
    );
}
