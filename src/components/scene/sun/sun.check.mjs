/*
* Check of the sun math (sun.js) against known solar positions. Run: node src/components/scene/sun/sun.check.mjs
* Prints OK, or throws on the first failed assertion.
*/
import assert from 'node:assert/strict';
import { sunPosition, localTimeToDate, sunDirection, findCity } from './sun.js';

const DEG = 180 / Math.PI;
const near = (actual, expected, tolerance, label) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual.toFixed(2)} vs ${expected}`);
const at = (cityId, day, hh, mm) => {
    const city = findCity(cityId);
    const { azimuth, altitude } = sunPosition(localTimeToDate(2026, day, hh * 60 + mm, city.timeZone), city.lat, city.lon);
    return { az: azimuth * DEG, alt: altitude * DEG };
};

// Clock -> UTC with daylight saving time: Rome is UTC+2 on June 21st, UTC+1 on December 21st
assert.equal(localTimeToDate(2026, 172, 13 * 60, 'Europe/Rome').toISOString(), '2026-06-21T11:00:00.000Z');
assert.equal(localTimeToDate(2026, 355, 13 * 60, 'Europe/Rome').toISOString(), '2026-12-21T12:00:00.000Z');

// Turin, summer solstice, solar noon ~13:29 CEST: due south, altitude 90 - 45.07 + 23.44 = 68.4
let sun = at('turin', 172, 13, 29);
near(sun.az, 180, 1.5, 'Turin June noon azimuth');
near(sun.alt, 68.4, 0.5, 'Turin June noon altitude');
// Turin, winter solstice, solar noon ~12:24 CET: altitude 90 - 45.07 - 23.44 = 21.5
sun = at('turin', 355, 12, 24);
near(sun.alt, 21.5, 0.5, 'Turin December noon altitude');
// Morning sun in the east, evening sun in the west, night below the horizon
assert.ok(at('turin', 172, 8, 0).az < 120, 'morning sun in the east');
assert.ok(at('turin', 172, 19, 0).az > 240, 'evening sun in the west');
assert.ok(at('turin', 172, 1, 0).alt < 0, 'night');
// Southern hemisphere: Sydney's noon sun is in the north
assert.ok(Math.abs(at('sydney', 172, 12, 0).az - 360) < 15 || at('sydney', 172, 12, 0).az < 15, 'Sydney noon sun to the north');

// Room direction: sun due south, back wall facing north (northDeg 0) -> towards +Z; 90° high -> +Y
let [x, y, z] = sunDirection(Math.PI, 0, 0);
near(x, 0, 1e-9, 'x'); near(y, 0, 1e-9, 'y'); near(z, 1, 1e-9, 'z');
[x, y, z] = sunDirection(Math.PI / 2, 0, 0); // east -> +X (clockwise from -Z seen from above)
near(x, 1, 1e-9, 'east x');
[, y] = sunDirection(0, Math.PI / 2, 37);
near(y, 1, 1e-9, 'zenith');

console.log('OK');
