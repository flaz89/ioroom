import { useMemo } from 'react';
import { useStore } from '../../store/appStore';
import { sunLighting } from '../scene/sun/sunLighting';
import SunArc from '../scene/sun/SunArc';

const SUN_DISTANCE = 15; // meters from the room center (inside the shadow camera's far plane)

/*
* Scene lights: an ambient light plus the sun, the only directional light (it casts the shadows).
* The sun follows the real solar arc of the environment's location, day and clock time (store `sun`,
* edited in the sun panel; values from sun/sunLighting.js); it fades out and turns warm near the horizon,
* and the ambient light dims at night. SunArc shows the sun's path while the day/time sliders move.
* ponytail: the light lives in world space, so in tabletop mode a board turned by hand does not turn the
* sun with it; parent the light to the Board when that matters.
*/
export default function Light() {
    const sun = useStore((state) => state.sun);
    const lighting = useMemo(() => sunLighting(sun), [sun]);

    return(
        <>
            <ambientLight intensity={lighting.ambient}/>

            {/* Target: default (world origin = room center) */}
            <directionalLight
                castShadow
                position={lighting.direction.map((value) => value * SUN_DISTANCE)}
                intensity={lighting.intensity}
                color={lighting.color}
                shadow-camera-far={50}
                shadow-camera-left={-10}
                shadow-camera-right={10}
                shadow-camera-top={10}
                shadow-camera-bottom={-10}
                shadow-mapSize={[2048, 2048]}
            />

            <SunArc sun={sun} lighting={lighting} />
        </>
    );
}
