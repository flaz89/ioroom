import { Color } from 'three';

/*
* SKY COLORS from the sun (SkyDome.jsx, VR only: the view out of the windows). Pure: check in sky.check.mjs.
*
* skyColor(direction, sunDirection, altitude, target) -> target (THREE.Color, linear working space)
* - direction: unit [x, y, z] from the viewer (y up); sunDirection: unit [x, y, z] towards the sun (sunLighting);
*   altitude: the sun's, radians (negative at night).
* - Three moments blended by the sun's height (sin of the altitude): NIGHT (deep blue), TWILIGHT (dusky, sun at
*   the horizon), DAY (blue zenith, pale horizon). Above the horizon the color goes from the horizon's to the
*   zenith's; below it, darker towards the ground (seen from the tabletop and through floor-level windows).
* - GLOW: a warm halo around the sun at dawn / dusk, a faint pale one by day.
* Calibration knobs: the colors and heights below (tune on the headset).
*/
const NIGHT = { zenith: new Color('#070b1c'), horizon: new Color('#141b35') };
const TWILIGHT = { zenith: new Color('#2b3c70'), horizon: new Color('#b49aa0') };
const DAY = { zenith: new Color('#4f86c9'), horizon: new Color('#d6e4f2') };
const GROUND_DARKEN = 0.45;              // horizon color x this, straight down
const GLOW_TWILIGHT = new Color('#ffa463');
const GLOW_DAY = new Color('#fff6e0');
const NIGHT_HEIGHT = -0.2;               // sin(altitude): full night below this
const DAY_HEIGHT = 0.35;                 // full day above this

const smoothstep = (from, to, value) => {
    const t = Math.min(Math.max((value - from) / (to - from), 0), 1);
    return t * t * (3 - 2 * t);
};

const _zenith = new Color(), _horizon = new Color(), _other = new Color(), _glow = new Color();

export function skyColor(direction, sunDirection, altitude, target = new Color()) {
    const height = Math.sin(altitude);
    const dusk = smoothstep(NIGHT_HEIGHT, 0, height); // 0 night .. 1 sun at the horizon
    const day = smoothstep(0, DAY_HEIGHT, height);    // 0 sun at the horizon .. 1 day
    _zenith.copy(NIGHT.zenith).lerp(TWILIGHT.zenith, dusk).lerp(DAY.zenith, day);
    _horizon.copy(NIGHT.horizon).lerp(TWILIGHT.horizon, dusk).lerp(DAY.horizon, day);

    const up = direction[1];
    if (up >= 0) target.copy(_horizon).lerp(_zenith, Math.pow(up, 0.6));
    else target.copy(_horizon).lerp(_other.copy(_horizon).multiplyScalar(GROUND_DARKEN), Math.min(1, -up * 3));

    // halo around the sun: wide and warm at dawn / dusk, small and pale by day, none at night
    const toSun = Math.max(0, direction[0] * sunDirection[0] + direction[1] * sunDirection[1] + direction[2] * sunDirection[2]);
    const twilight = dusk * (1 - day);
    _glow.copy(GLOW_TWILIGHT).multiplyScalar(0.8 * twilight * Math.pow(toSun, 6))
        .add(_other.copy(GLOW_DAY).multiplyScalar(0.25 * day * Math.pow(toSun, 24)));
    return target.add(_glow);
}
