// Self-check for walk.js. Run: node src/components/scene/controls/walk.check.mjs
import assert from 'node:assert/strict';
import { BODY_RADIUS, BOOM_MIN, EYE_HEIGHT, MIN_HEADROOM, boomLength, canWalk, ceilingAt, eyeHeight, standingPoint, walkStep } from './walk.js';
import { DEFAULT_PLAN, activeLevel, roofHeightAt } from '../../../plan/planModel.js';

// the 6 x 6 room, a door in the middle of the back wall (z = -3 .. -3.15) and a second room behind it
const base = activeLevel(DEFAULT_PLAN);
const door = { id: 'door', type: 'door', offset: 3, width: 0.9, height: 2.1, sill: 0 };
const level = {
    ...base,
    walls: base.walls.map((wall) => (wall.id === 'wall-back' ? { ...wall, openings: [door] } : wall)),
    floors: [...base.floors, { id: 'behind', points: [[-3, -6], [3, -6], [3, -3.15], [-3, -3.15]] }]
};
const inWall = [0, -3.07];

// rooms yes, the wall no, a closed door no, an open door yes, beside the door (in the wall) no
assert.ok(canWalk(level, [0, 0]));
assert.ok(canWalk(level, [0, -4]));
assert.ok(!canWalk(level, [-2, -3.07]));
assert.ok(!canWalk(level, inWall));
assert.ok(canWalk(level, inWall, { door: true }));
assert.ok(!canWalk(level, [0.4, -3.07], { door: true }), 'too close to the jamb');
// a passage is always open
const passage = { ...level, walls: level.walls.map((w) => (w.id === 'wall-back' ? { ...w, openings: [{ ...door, operation: 'passage' }] } : w)) };
assert.ok(canWalk(passage, inWall));
// a window sill above the floor is never a doorway
const window_ = { ...level, walls: level.walls.map((w) => (w.id === 'wall-back' ? { ...w, openings: [{ ...door, type: 'window', operation: 'hole', sill: 0.9 }] } : w)) };
assert.ok(!canWalk(window_, inWall));

// walking into the closed door: stops before it, the body radius away from the wall
let p = [0, -2];
for (let i = 0; i < 100; i++) p = walkStep(level, p, [0, -0.05]);
assert.ok(p[1] > -3 + BODY_RADIUS - 0.06 && p[1] <= -2, `stopped at ${p}`);
// open: walks through into the next room
p = [0, -2];
for (let i = 0; i < 100; i++) p = walkStep(level, p, [0, -0.05], { door: true });
assert.ok(p[1] < -4, `went through: ${p}`);
// diagonally into the left wall: slides along it instead of sticking
p = [-2.5, 0];
for (let i = 0; i < 20; i++) p = walkStep(level, p, [-0.05, -0.05]);
assert.ok(p[1] < -0.9 && p[0] > -3, `slid: ${p}`);

assert.equal(eyeHeight(level, [0, 0]), EYE_HEIGHT);

// stuck in a wall (or outside every floor): moves are let through, to walk out
assert.ok(Math.abs(walkStep(level, [-2, -3.07], [0, 0.1])[1] + 2.97) < 1e-9);
// start search: a walkable point stays, a point in the wall or outside finds the closest place to stand
assert.deepEqual(standingPoint(level, [1, 1]), [1, 1]);
const found = standingPoint(level, [-2, -3.07]);
assert.ok(canWalk(level, found) && Math.hypot(found[0] + 2, found[1] + 3.07) < 0.7, `closest: ${found}`);
const outside = standingPoint(level, [10, 0]);
assert.ok(canWalk(level, outside) && outside[0] < 3, `from outside: ${outside}`);

// third person boom: free behind = full length; a wall 1 m behind = shorter; against it = the minimum
assert.equal(boomLength(level, [0, 1.6, 0], [0, 0, 1], 2.5), 2.5);
const short = boomLength(level, [0, 1.6, 2], [0, 0, 1], 2.5);
assert.ok(short < 1 && short >= BOOM_MIN, `wall behind: ${short}`);
assert.equal(boomLength(level, [0, 1.6, 2.95], [0, 0, 1], 2.5), BOOM_MIN);
// walking back towards that wall 1 cm at a time: the boom shrinks smoothly (no 10 cm jumps)
let last = boomLength(level, [0, 1.6, 0], [0, 0, 1], 2.5);
for (let z = 0.01; z < 2.3; z += 0.01) {
    const length = boomLength(level, [0, 1.6, z], [0, 0, 1], 2.5);
    assert.ok(Math.abs(length - last) < 0.02, `smooth at ${z}: ${last} -> ${length}`);
    last = length;
}

// CEILINGS. Flat at 2.4 m: no limit at eye height, the boom going up stops under it
const room = base.floors[0].points;
const flat = { ...level, ceilings: [{ id: 'c', points: room, height: 2.4 }] };
assert.equal(ceilingAt(flat, [0, 0]), 2.4);
assert.equal(ceilingAt(flat, [0, -4]), Infinity, 'no ceiling over the room behind');
assert.equal(eyeHeight(flat, [0, 0]), EYE_HEIGHT);
const up = [0, Math.SQRT1_2, Math.SQRT1_2]; // 45° up and back
const underFlat = boomLength(flat, [0, 1.6, 0], up, 2.5);
assert.ok(1.6 + underFlat * up[1] <= 2.4 - 0.2 + 1e-9 && underFlat > 0.6, `under the ceiling: ${underFlat}`);
// ceilings hidden: only the walls, the full length again
assert.equal(boomLength(flat, [0, 1.6, 0], up, 2.5, {}, false), 2.5);
// low flat ceiling (2 m): eyes stoop under it, 1.1 m: not walkable
assert.ok(Math.abs(eyeHeight({ ...flat, ceilings: [{ id: 'c', points: room, height: 1.6 }] }, [0, 0]) - 1.45) < 1e-9);
assert.ok(!canWalk({ ...flat, ceilings: [{ id: 'c', points: room, height: MIN_HEADROOM - 0.1 }] }, [0, 0]));

// pitched (gable on the two side edges): same heights as planModel roofHeightAt, lower at the eaves
const gable = { id: 'g', points: room, height: 0.8, roof: { eaves: [0, 2] } };
const pitched = { ...level, ceilings: [gable] };
for (const p of [[0, 0], [-2.5, 1], [2, -2], [1, 2.5]]) {
    assert.ok(Math.abs(ceilingAt(pitched, p) - roofHeightAt(gable, pitched, p)) < 1e-9, `same roof at ${p}`);
}
const eave = ceilingAt(pitched, [0, -2.9]), ridge = ceilingAt(pitched, [0, 0]);
assert.ok(eave < ridge, `slopes down to the eaves: ${eave} < ${ridge}`);
// near the eave: stooping, then not walkable at all; the boom under the slope stays under it
assert.ok(eyeHeight(pitched, [0, -2.5]) < EYE_HEIGHT || ceilingAt(pitched, [0, -2.5]) > EYE_HEIGHT + 0.15);
assert.ok(!canWalk(pitched, [0, -2.95]), 'under the eave');
const towardsEave = [0, Math.SQRT1_2, -Math.SQRT1_2];
const b = boomLength(pitched, [0, 1.6, 0.5], towardsEave, 2.5);
const camera = [0, 0.5 - b * Math.SQRT1_2];
assert.ok(b > BOOM_MIN && b < 2.5, `pulled in by the slope: ${b}`);
assert.ok(1.6 + b * Math.SQRT1_2 <= ceilingAt(pitched, camera) - 0.2 + 1e-9, `boom under the slope: ${b}`);
console.log('walk.js ok');
