import { useMemo } from 'react';
import { AdditiveBlending } from 'three';
import { useStore } from '../../../store/appStore';
import { Line } from '../controls/pivot-controls/Line';
import { sunAt } from './sunLighting';
import { sunDirection } from './sun';

/*
* Visual helper for the sun panel: the sun's path over the selected day as an arc (a "rail") around the
* room center, with a glowing sphere at the current sun position, tinted like the sunlight.
* Shown only while the day/time sliders move (store sunArcVisible, see sunSlice.js).
* Centered on the floor plan, radius = the plan's radius + ARC_MARGIN (props from Light.jsx: levelBounds);
* inside the Board (via Light), so in tabletop
* mode it keeps the same proportion to the model as on desktop. Only the part above the horizon is drawn;
* the sphere hides at night. Drawn on top of everything (no depth test): from inside the room in VR the
* walls would hide it. Not interactive: raycasting is disabled, so it never blocks object picking.
*/
const ARC_MARGIN = 0.05;         // meters beyond the plan's radius (6 x 6 room: ~4.5 m, as before)
const SAMPLE_MINUTES = 10;       // arc resolution
const SPHERE_RADIUS = 0.18;
const HALO_RADIUS = 0.42;
const ARC_COLOR = '#ffb733';
const noRaycast = () => null;

export default function SunArc({ sun, lighting, center, radius }) {
    const isVisible = useStore((state) => state.sunArcVisible);
    const arcRadius = radius + ARC_MARGIN;

    // Arc points: depends on location, day and orientation, not on the time of day.
    // ponytail: one run of points from midnight to midnight; a polar day/night edge case could draw a
    // single straight chord where the arc crosses midnight.
    const points = useMemo(() => {
        const result = [];
        for (let minutes = 0; minutes <= 1440; minutes += SAMPLE_MINUTES) {
            const { azimuth, altitude } = sunAt(sun, minutes);
            if (altitude < 0) continue;
            result.push(sunDirection(azimuth, altitude, sun.northDeg).map((value) => value * arcRadius));
        }
        return result;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `minutes` intentionally ignored
    }, [sun.cityId, sun.day, sun.northDeg, arcRadius]);

    if (!isVisible || points.length < 2) return null;
    const position = lighting.direction.map((value) => value * arcRadius);
    const isDay = lighting.altitude > 0;

    return (
        <group position={[center[0], 0, center[1]]}>
            <Line points={points} color={ARC_COLOR} lineWidth={2} transparent opacity={0.7} depthTest={false} renderOrder={10} raycast={noRaycast} />
            {isDay && (
                <group position={position}>
                    {/* Core: unlit, not tone mapped -> reads as emissive */}
                    <mesh raycast={noRaycast} renderOrder={11}>
                        <sphereGeometry args={[SPHERE_RADIUS, 24, 16]} />
                        <meshBasicMaterial color={lighting.color} depthTest={false} toneMapped={false} />
                    </mesh>
                    {/* Halo: additive translucent shell, fakes a glow without post-processing */}
                    <mesh raycast={noRaycast} renderOrder={11}>
                        <sphereGeometry args={[HALO_RADIUS, 24, 16]} />
                        <meshBasicMaterial color={lighting.color} transparent opacity={0.25}
                            blending={AdditiveBlending} depthTest={false} depthWrite={false} toneMapped={false} />
                    </mesh>
                </group>
            )}
        </group>
    );
}
