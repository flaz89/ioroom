// Check for sky.js: node src/components/scene/sun/sky.check.mjs
import assert from 'node:assert/strict';
import { skyColor } from './sky.js';

const up = [0, 1, 0];
const sunEast = (altitude) => [Math.cos(altitude), Math.sin(altitude), 0]; // the sun in +x
const at = (direction, altitude) => skyColor(direction, sunEast(altitude), altitude);
const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const noon = 1.2, sunset = 0.01, night = -0.6;

// by day: blue zenith, paler (brighter) horizon
const zenith = at(up, noon), horizonWest = at([-1, 0, 0], noon);
assert.ok(zenith.b > zenith.r, 'blue zenith by day');
assert.ok(luminance(horizonWest) > luminance(zenith), 'pale horizon by day');
// night far darker than day
assert.ok(luminance(at(up, night)) < luminance(zenith) * 0.1, 'dark at night');
// sunset: warm towards the sun, not on the opposite side
const towardsSun = at([1, 0.02, 0], sunset), away = at([-1, 0.02, 0], sunset);
assert.ok(towardsSun.r > towardsSun.b && towardsSun.r > away.r + 0.2, 'warm glow on the sun\'s side at sunset');
// no glow at night, even looking where the sun is (below the horizon)
assert.ok(Math.abs(at([1, 0, 0], night).r - at([-1, 0, 0], night).r) < 1e-6, 'no glow at night');
// below the horizon darker than at the horizon
assert.ok(luminance(at([0, -1, 0], noon)) < luminance(horizonWest), 'darker towards the ground');
console.log('sky: ok');
