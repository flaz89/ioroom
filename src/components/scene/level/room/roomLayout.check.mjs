// Check for roomLayout.js: node src/components/scene/level/room/roomLayout.check.mjs
import assert from 'node:assert/strict';
import { WALL_HEIGHT, WALL_THICKNESS, surfaceAreas, surfaceLabel } from './roomLayout.js';

const areas = surfaceAreas([6, 4]);
const h = WALL_HEIGHT, t = WALL_THICKNESS;
const near = (a, b) => Math.abs(a - b) < 0.011;
assert.ok(near(areas.floor, 24));
// inside faces: only what the room sees (no corner overlap)
assert.ok(near(areas['wall-back:inner'], 6 * h), `back inner ${areas['wall-back:inner']}`);
assert.ok(near(areas['wall-left:inner'], 4 * h));
// outside face of the back wall: full length, corners included
assert.ok(near(areas['wall-back:outer'], (6 + 2 * t) * h));
// edge = top + the open end (bottom never built)
assert.ok(near(areas['wall-left:edge'], t * 4 + t * h * 2));
assert.equal(surfaceLabel('wall-right:outer'), 'Right wall · outside');
console.log('roomLayout: ok');
