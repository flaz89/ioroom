// Check for doorModel.js: node src/components/scene/level/room/doorModel.check.mjs
import assert from 'node:assert/strict';
import { CASING_DEPTH, LINING, MEETING_GAP, doorParts } from './doorModel.js';
import { DEFAULT_PLAN, activeLevel, addOpening, faceOffsets, updateOpening } from '../../../../plan/planModel.js';

const level = activeLevel(DEFAULT_PLAN);
const withDoor = addOpening(level, 'wall-back', 'door', 'd1'); // 0.9 x 2.1, centered at 3 m: 2.55..3.45
const wallOf = (lvl) => lvl.walls.find((w) => w.id === 'wall-back');
const doorOf = (lvl) => wallOf(lvl).openings[0];
const parts = (lvl) => doorParts(wallOf(lvl), doorOf(lvl), 2.7);
const { inner, outer } = faceOffsets(wallOf(withDoor));
const c0 = Math.min(inner, outer), c1 = Math.max(inner, outer);
const eps = 1e-9;
const inside = (b, lo, hi, axis) => b.min[axis] >= lo - eps && b.max[axis] <= hi + eps;
// a point of the leaf (dx, dc from the hinge) turned by the open angle
const turn = ([dx, dc], a) => [dx * Math.cos(a) - dc * Math.sin(a), dx * Math.sin(a) + dc * Math.cos(a)];

// single leaf, hinge 'start', swing 'in'
const door = parts(withDoor);
assert.equal(door.frame.length, 3 + 6, 'lining (jambs + head) + casing on both faces');
for (const b of door.frame.slice(0, 3)) assert.ok(inside(b, c0, c1, 2) && inside(b, 2.55, 3.45, 0), 'lining inside the reveal');
for (const b of door.frame.slice(3)) assert.ok(inside(b, c0 - CASING_DEPTH, c0, 2) || inside(b, c1, c1 + CASING_DEPTH, 2), 'casing on a face');
assert.equal(door.leaves.length, 1);
const [leaf] = door.leaves;
assert.ok(inside(leaf.leaf, 2.55 + LINING, 3.45 - LINING, 0) && inside(leaf.leaf, c0, c1, 2), 'leaf inside the lining');
assert.ok(Math.abs(leaf.leaf.min[2] - c0) < eps, "swing 'in': flush with the face with the smaller c");
assert.ok(Math.abs(leaf.hinge[0] - leaf.leaf.min[0]) < eps, "hinge 'start': the edge towards a");
const free = turn([leaf.leaf.max[0] - leaf.hinge[0], 0], leaf.openAngle);
assert.ok(free[1] < -0.5 && Math.abs(free[0]) < 1e-6, `opens towards -c: ${free}`);
assert.equal(leaf.handle.length, 6, 'rose + stem + lever on both faces');
// the stem joins the rose (on the leaf face) to the lever (out from it), on each face
for (const [rose, stem, lever] of [leaf.handle.slice(0, 3), leaf.handle.slice(3)]) {
    const touches = (p, q) => p.min[2] <= q.max[2] + eps && q.min[2] <= p.max[2] + eps;
    assert.ok(touches(stem, rose) && touches(stem, lever), 'stem from the rose to the lever');
}
assert.ok(leaf.handle.every((b) => b.min[0] > leaf.hinge[0] + 0.5), 'handle near the free edge');

// swing 'out', hinge 'end': flush with the other face, hinge at the far edge, opens towards +c
const flipped = parts(updateOpening(withDoor, 'wall-back', 'd1', { swing: 'out', hinge: 'end' }));
const [out] = flipped.leaves;
assert.ok(Math.abs(out.leaf.max[2] - c1) < eps && Math.abs(out.hinge[0] - out.leaf.max[0]) < eps);
const freeOut = turn([out.leaf.min[0] - out.hinge[0], 0], out.openAngle);
assert.ok(freeOut[1] > 0.5, `opens towards +c: ${freeOut}`);

// double door: two leaves hinged at the outer edges, opening the same side, mirrored
const pair = parts(updateOpening(updateOpening(withDoor, 'wall-back', 'd1', { width: 1.6, offset: 3 }), 'wall-back', 'd1', { leaves: 2 }));
assert.equal(pair.leaves.length, 2);
assert.ok(pair.leaves[0].hinge[0] < pair.leaves[1].hinge[0] && pair.leaves[0].openAngle === -pair.leaves[1].openAngle);
assert.ok(Math.abs(pair.leaves[1].leaf.min[0] - pair.leaves[0].leaf.max[0] - MEETING_GAP) < eps, 'a visible joint between the leaves');

// not built yet: windows, sliding and pocket doors
assert.equal(doorParts(wallOf(withDoor), { ...doorOf(withDoor), operation: 'slide' }, 2.7), null);
assert.equal(doorParts(wallOf(addOpening(level, 'wall-back', 'window', 'w1')), wallOf(addOpening(level, 'wall-back', 'window', 'w1')).openings[0], 2.7), null);
console.log('doorModel: ok');
