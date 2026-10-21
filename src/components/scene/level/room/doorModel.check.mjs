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

// every swing leaf turns, never shifts
assert.ok(door.leaves.every((l) => l.openShift === 0));
const span = (b) => [b.min[0], b.max[0]];
const overlaps = (p, q) => p[0] < q[1] - eps && q[0] < p[1] - eps;
const shifted = (l) => span(l.leaf).map((x) => x + l.openShift);

// SLIDE (on the inner face): leaves in front of the casing, mirrored out of the reveal when open, a rail above
const slide = parts(updateOpening(withDoor, 'wall-back', 'd1', { operation: 'slide' }));
const [slider] = slide.leaves;
assert.equal(slider.openAngle, 0);
assert.ok(slider.leaf.max[2] < c0 - CASING_DEPTH + eps, 'in front of the inner face and its casing');
assert.ok(shifted(slider)[1] <= 2.55 + eps, `slides past the reveal's start: ${shifted(slider)}`);
assert.equal(slide.frame.length, 3 + 6 + 1, 'lining + casing + rail');
const rail = slide.frame.at(-1);
assert.ok(rail.min[1] >= slider.leaf.max[1] && rail.min[0] <= shifted(slider)[0] + eps, 'the rail runs over the whole travel');
assert.equal(slider.handle.length, 6, 'bar + 2 stems on both faces');

// SLIDE, 2 leaves: opposite ways, alternating tracks; 4 leaves: two each way, stacked without overlapping
const slide4 = parts(updateOpening(updateOpening(withDoor, 'wall-back', 'd1', { width: 2.4, offset: 3, operation: 'slide' }), 'wall-back', 'd1', { leaves: 4 }));
const tracks = slide4.leaves.map((l) => l.leaf.min[2]);
assert.ok(tracks[0] !== tracks[1] && tracks[0] === tracks[2], 'alternating tracks');
const open4 = slide4.leaves.map(shifted);
assert.ok(!overlaps(open4[0], open4[1]) && !overlaps(open4[2], open4[3]), 'open leaves of a side do not overlap');
assert.ok(open4[0][1] <= open4[1][0] + eps || open4[1][1] <= open4[0][0] + eps);
const rail4 = slide4.frame.at(-1), reach4 = open4.flat();
assert.ok(Math.abs(rail4.min[0] - Math.min(...reach4)) < eps && Math.abs(rail4.max[0] - Math.max(...reach4)) < eps, 'the rail ends where the open leaves end');

// POCKET (1 leaf towards the start): on the wall's axis, inside the faces, split jamb on the pocket side
// (the leaf runs through its slot), open = in the wall but for 5 cm past the jamb
const pocket = parts(updateOpening(withDoor, 'wall-back', 'd1', { operation: 'pocket' }));
const [pocketLeaf] = pocket.leaves;
assert.ok(pocketLeaf.leaf.min[2] > c0 && pocketLeaf.leaf.max[2] < c1, 'inside the wall');
assert.equal(pocket.frame.length, 2 + 6 + 2, 'jamb + head + casing + split jamb on the pocket side');
const split = pocket.frame.slice(-2);
assert.ok(split.every((b) => b.min[0] === 2.55 && b.max[1] > 2), 'split jamb at the pocket side');
assert.ok(split[0].min[2] === c0 && split[0].max[2] < pocketLeaf.leaf.min[2] && split[1].min[2] > pocketLeaf.leaf.max[2] && split[1].max[2] === c1, 'slot around the leaf');
assert.ok(Math.abs(shifted(pocketLeaf)[1] - (2.55 + LINING + 0.05)) < 1e-6, `open: 5 cm out of the jamb: ${shifted(pocketLeaf)}`);
assert.ok(pocketLeaf.handle.every((b) => b.max[2] - b.min[2] < 0.01), 'flat pulls');
assert.equal(parts(updateOpening(withDoor, 'wall-back', 'd1', { operation: 'passage' })), null, 'a passage is just the hole');
assert.equal(doorParts(wallOf(addOpening(level, 'wall-back', 'window', 'w1')), wallOf(addOpening(level, 'wall-back', 'window', 'w1')).openings[0], 2.7), null);
console.log('doorModel: ok');
