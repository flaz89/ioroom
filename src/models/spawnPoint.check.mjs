// Check for spawnPoint.js: node src/models/spawnPoint.check.mjs
import assert from 'node:assert/strict';
import { spawnPoint } from './spawnPoint.js';

// 6 x 6 room (walls on x = ±3 and z = -3, 15 cm thick, outside), one floor raised 10 cm
const level = {
    walls: [
        { id: 'l', a: [-3, 3], b: [-3, -3], thickness: 0.15 },
        { id: 'b', a: [-3, -3], b: [3, -3], thickness: 0.15 },
        { id: 'r', a: [3, -3], b: [3, 3], thickness: 0.15 }
    ],
    floors: [{ id: 'f', points: [[-3, -3], [3, -3], [3, 3], [-3, 3]], elevation: 0.1 }]
};
// the view center on the floor: there, on top of the floor
assert.deepEqual(spawnPoint(level, [1, 2]), [1, 0.1, 2]);
// outside the floor (or in the sky): the plan's center
const center = spawnPoint(level, [10, 10]);
assert.ok(Math.abs(center[0]) < 0.1 && Math.abs(center[2]) < 0.1 && center[1] === 0.1);
assert.deepEqual(spawnPoint(level, null), center);
// inside a wall: the center
assert.deepEqual(spawnPoint(level, [-3.05, 0]), center);
console.log('spawnPoint: ok');
