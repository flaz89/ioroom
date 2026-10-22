import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Object3D, Vector3 } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../../store/appStore';
import { sunLighting } from '../scene/sun/sunLighting';
import SunArc from '../scene/sun/SunArc';
import { activeLevel, levelBounds } from '../../plan/planModel';

// Sizes from the plan (planModel.levelBounds: center + radius of the walls' footprint), room meters
const SUN_MARGIN = 10;      // sun distance = plan radius + this (6 x 6 room: ~14.5 m)
const SHADOW_MARGIN = 1.5;  // shadow camera half side = plan radius + this (walls cast shadows outside)
// ponytail: one 2048 shadow map: past this half side the shadows would get too blurry, so they are cut;
// big buildings need cascaded shadows (graphics quality presets)
const MAX_SHADOW_HALF = 15;
const SHADOW_NEAR = 0.5;   // room meters
const NORMAL_BIAS = 0.02;  // room meters: removes shadow acne on the walls/floor

const _scale = new Vector3();

/*
* Scene lights: the sun, the only directional light (it casts the shadows), plus the environment map's
* fill light (SceneEnvironment.jsx; no ambient light: the environment replaces it), dimmed here at night.
* The sun follows the real solar arc of the environment's location, day and clock time (store `sun`,
* edited in the sun panel; values from sun/sunLighting.js); it fades out and turns warm near the horizon,
* and the environment light dims at night. SunArc shows the sun's path while the day/time sliders move.
*
* Centered on the floor plan and sized from it (levelBounds): the target is the plan's center, the sun
* stays outside the building, the shadow camera covers the plan (capped: MAX_SHADOW_HALF), and the
* sun arc goes around it; all follow the plan as it is edited.
* Lives INSIDE the Board (level/Level.jsx): position, arc and shadows are in room units, so in tabletop
* mode they shrink, move and turn with the model. The shadow camera is sized in world units by three.js,
* so its frustum (and normal bias) is rescaled here whenever the board scale changes (two-hand zoom):
* the shadow map always covers just the room, as sharp in the miniature as at 1:1.
*/
export default function Light() {
    const sun = useStore((state) => state.sun);
    const lighting = useMemo(() => sunLighting(sun), [sun]);
    const lightRef = useRef();
    // fill light follows the sun (scene-wide: the environment is set on the scene, not on the board)
    const scene = useThree((state) => state.scene);
    useLayoutEffect(() => { scene.environmentIntensity = lighting.environment; }, [scene, lighting]);
    const appliedScale = useRef(''); // scale | shadow size | sun distance last applied to the shadow camera
    // Plan size: center [x, z] and radius (m) of the level being worked on
    const level = useStore((state) => activeLevel(state.plan));
    const { center, radius } = useMemo(() => levelBounds(level), [level]);
    const sunDistance = radius + SUN_MARGIN;
    const shadowHalf = Math.min(radius + SHADOW_MARGIN, MAX_SHADOW_HALF);

    // Target at the plan's center, inside the board so it follows it (a light's target must be in the scene)
    const [target] = useState(() => new Object3D());
    useLayoutEffect(() => { target.position.set(center[0], 0, center[1]); }, [target, center]);

    useFrame(() => {
        const light = lightRef.current;
        const scale = light.parent.getWorldScale(_scale).x; // board scale (uniform)
        const key = `${scale}|${shadowHalf}|${sunDistance}`; // re-applied on zoom or plan size change
        if (key === appliedScale.current) return;
        appliedScale.current = key;
        const camera = light.shadow.camera;
        camera.left = camera.bottom = -shadowHalf * scale;
        camera.right = camera.top = shadowHalf * scale;
        camera.near = SHADOW_NEAR * scale;
        camera.far = 2 * sunDistance * scale; // the building is around the target, half way
        camera.updateProjectionMatrix();
        light.shadow.normalBias = NORMAL_BIAS * scale;
    });

    return(
        <>
            <primitive object={target} />
            <directionalLight
                ref={lightRef}
                castShadow
                target={target}
                position={[center[0] + lighting.direction[0] * sunDistance, lighting.direction[1] * sunDistance, center[1] + lighting.direction[2] * sunDistance]}
                intensity={lighting.intensity}
                color={lighting.color}
                shadow-mapSize={[2048, 2048]}
            />

            <SunArc sun={sun} lighting={lighting} center={center} radius={radius} />
        </>
    );
}
