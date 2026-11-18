// Self-check for teleport.js. Run: node src/components/scene/xr-ui/teleport.check.mjs
import assert from 'node:assert/strict';
import { MAX_DISTANCE, canLand, groundHeight, isTeleportPose, rotateY, startOrigin, teleportArc, teleportOrigin } from './teleport.js';
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
// RAISED FLOOR: the arc lands on its top (+0.40) and says so; around it the ground stays at 0
const stage = { ...level, floors: [...level.floors, { id: 'stage', points: [[-2, -7], [2, -7], [2, -3], [-2, -3]], elevation: 0.4 }] };
assert.equal(groundHeight(stage, [0, -5]), 0.4);
assert.equal(groundHeight(stage, [0, 0]), 0);
assert.equal(groundHeight(stage, [20, 0]), 0, 'off every floor');
const onStage = teleportArc([0, 1.2, 0], up45, (point) => groundHeight(stage, point));
assert.equal(onStage.height, 0.4);
assert.equal(onStage.points.at(-1)[1], 0.4);
assert.ok(onStage.landing[1] > landing[1], `lands a bit sooner, on the stage: ${onStage.landing}`);
assert.equal(teleportArc([0, 1.2, 0], up45).height, 0);
// no floors yet: inside the walls' bounds
assert.equal(canLand({ ...level, floors: [] }, [1, 1]), true);
assert.equal(canLand({ ...level, floors: [] }, [10, 0]), false);

// XR origin: world = rotateY(base, yaw) + p
const world = (origin, b) => { const [x, z] = rotateY(b, origin.yaw); return [x + origin.p[0], z + origin.p[1]]; };
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;
// rotateY is three's: +90° turns +X into -Z, a yaw-0 forward (-Z) into -X
assert.ok(near(rotateY([1, 0], Math.PI / 2), [0, -1]) && near(rotateY([0, -1], Math.PI / 2), [-1, 0]));
// teleport: the head lands on the target, also with a turned origin, and moves add up
let origin = { p: [0, 0], yaw: 0 };
origin = teleportOrigin(origin, world(origin, [1, 2]), [4, -1]);
assert.ok(near(world(origin, [1, 2]), [4, -1]), 'head lands on the target');
origin = { p: [3, 1], yaw: 1.1 };
origin = teleportOrigin(origin, world(origin, [0.5, -0.2]), [0, 0]);
assert.ok(near(world(origin, [0.5, -0.2]), [0, 0]), 'turned origin');
// player start: the head (a bit off the base origin, turned 30°) ends on the start, facing its yaw
const start = { p: [2, -3], yaw: 2 };
const startAt = startOrigin(start, [0.3, -0.4], Math.PI / 6);
assert.ok(near(world(startAt, [0.3, -0.4]), start.p), 'head on the start');
assert.ok(Math.abs(startAt.yaw + Math.PI / 6 - start.yaw) < 1e-12, 'facing the start yaw');
// pose: raised hand with the back towards the user yes; hanging along the body, palm towards the user,
// sideways or above the head no; a small drift while aiming keeps it (hysteresis)
assert.equal(isTeleportPose(0.35, 0.9, false), true);
assert.equal(isTeleportPose(0.85, 0.9, false), false, 'hanging arm');
assert.equal(isTeleportPose(0.35, -0.9, false), false, 'palm towards the user');
assert.equal(isTeleportPose(0.35, 0.1, false), false, 'sideways');
assert.equal(isTeleportPose(-0.3, 0.9, false), false, 'above the head');
assert.equal(isTeleportPose(0.55, 0.4, false), false);
assert.equal(isTeleportPose(0.55, 0.4, true), true, 'kept while aiming');
assert.equal(isTeleportPose(0.4, -0.5, true), true, 'wrist tilted down to aim close by');
assert.equal(isTeleportPose(0.7, 0.9, true), false, 'dropped while aiming');
console.log('teleport: ok');
