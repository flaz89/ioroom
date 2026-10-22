import { Color } from 'three';
import { findCity, localTimeToDate, sunDirection, sunPosition } from './sun';

/*
* Everything the scene derives from the sun settings (store `sun`): shared by the sun light
* (components/light/Light.jsx) and the sun arc helper (SunArc.jsx), so they always agree.
*
* sunLighting({ cityId, day, minutes, northDeg }) -> {
*   direction  - [x, y, z] unit vector from the room center towards the sun (room space, see sun.js)
*   altitude   - radians above the horizon (negative at night)
*   intensity  - directional light intensity (0 below the horizon)
*   environment - scene.environmentIntensity: the environment map's fill light (dimmer at night)
*   color      - THREE.Color of the sunlight (warm near the horizon, white-ish when high)
* }
* Constants are calibration knobs: tune them on the headset.
*/
const SUN_INTENSITY = 1.1;                    // high noon
const ENVIRONMENT_DAY = 0.6;                // fill light (reflections + indirect) by day
const ENVIRONMENT_NIGHT = 0.15;
const NOON_COLOR = new Color('#fffaf0');
const HORIZON_COLOR = new Color('#ffb066');   // low sun: warm light

// 0 below `from`, 1 above `to`, smooth in between
const smoothstep = (from, to, value) => {
    const t = Math.min(Math.max((value - from) / (to - from), 0), 1);
    return t * t * (3 - 2 * t);
};

// Sun's azimuth/altitude for the settings, at a given clock time (defaults to the settings' own)
export function sunAt({ cityId, day, minutes }, atMinutes = minutes) {
    const city = findCity(cityId);
    const date = localTimeToDate(new Date().getFullYear(), day, atMinutes, city.timeZone);
    return sunPosition(date, city.lat, city.lon);
}

/*
* Where to draw the sun or the moon on the compasses (degrees, compass bearing): the sun while it is up;
* after sunset the moon, opposite the sun. ponytail: symbolic moon (no lunar ephemeris), the compasses
* only need a night marker.
*/
export function skyMarkers(sun) {
    const { azimuth, altitude } = sunAt(sun);
    const degrees = azimuth * 180 / Math.PI;
    return altitude > 0 ? { sunAzimuth: degrees, moonAzimuth: null } : { sunAzimuth: null, moonAzimuth: (degrees + 180) % 360 };
}

export function sunLighting(sun) {
    const { azimuth, altitude } = sunAt(sun);
    const height = Math.sin(altitude); // 0 at the horizon, 1 at the zenith
    return {
        direction: sunDirection(azimuth, altitude, sun.northDeg),
        altitude,
        intensity: SUN_INTENSITY * smoothstep(0, 0.12, height),
        environment: ENVIRONMENT_NIGHT + (ENVIRONMENT_DAY - ENVIRONMENT_NIGHT) * smoothstep(-0.1, 0.25, height),
        color: HORIZON_COLOR.clone().lerp(NOON_COLOR, smoothstep(0, 0.5, height))
    };
}
