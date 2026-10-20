// Self-check for teleport.js. Run: node src/components/scene/xr-ui/teleport.check.mjs
import assert from 'node:assert/strict';
import { MAX_DISTANCE, canLand, teleportArc, teleportOffset } from './teleport.js';
import { DEFAULT_PLAN, activeLevel } from '../../../plan/planModel.js';

// a 45° throw from 1.2 m lands ahead, on the floor, past the top of the arc
const up45 = [0, Math.SQRT1_2, -Math.SQRT1_2];
const { points, landing } = teleportArc([0, 1.2, 0], up45);
assert.ok(landing && landing[1] < -4 && landing[1] > -7 && Math.abs(landing[0]) < 1e-9, `lands ~5 m ahead: ${landing}`);
assert.equal(points.at(-1)[1], 0);
assert.ok(Math.max(...points.map((p) => p[1])) > 1.2, 'goes up first');
// pointing at the sky: falls back at your feet (harmless: no move)
assert.ok(Math.hypot(...teleportArc([0, 1.2, 0], [0, 1, 0]).landing) < 1e-6);
// almost flat from high up: beyond reach -> no landing
assert.equal(teleportArc([0, 30, 0], [0, 0, -1]).landing, null);
// pointing down: lands right below-ahead
assert.ok(Math.hypot(...teleportArc([0, 1.2, 0], [0, -Math.SQRT1_2, -Math.SQRT1_2]).landing) < 1.2);
assert.ok(MAX_DISTANCE > 5);

// the default 6 x 6 room (floor 'floor', walls around): inside yes, inside a wall's thickness no, outside no
const level = activeLevel(DEFAULT_PLAN);
assert.equal(canLand(level, [0, 0]), true);
assert.equal(canLand(level, [-3.07, 0]), false, 'in the left wall');
assert.equal(canLand(level, [10, 0]), false, 'outside every floor');
// no floors yet: inside the walls' bounds
assert.equal(canLand({ ...level, floors: [] }, [1, 1]), true);
assert.equal(canLand({ ...level, floors: [] }, [10, 0]), false);

// offset: the head at world (1, 2) with no offset, target (4, -1): offset (-3, 3); world = base - offset
const offset = teleportOffset([0, 0], [1, 2], [4, -1]);
assert.deepEqual(offset, [-3, 3]);
assert.deepEqual([1 - offset[0], 2 - offset[1]], [4, -1], 'head lands on the target');
// a second teleport adds up: head now at (4, -1) (base still (1, 2)), target (0, 0)
const again = teleportOffset(offset, [4, -1], [0, 0]);
assert.deepEqual([1 - again[0], 2 - again[1]], [0, 0]);
console.log('teleport: ok');
