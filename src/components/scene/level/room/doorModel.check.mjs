// Check for doorModel.js: node src/components/scene/level/room/doorModel.check.mjs
import assert from 'node:assert/strict';
import { CASING_DEPTH, DEFAULT_PART_MATERIALS, LINING, MEETING_GAP, handleStyle, handleStyles, openingParts, partMaterialId } from './doorModel.js';
import { DEFAULT_PLAN, activeLevel, addOpening, faceOffsets, updateOpening } from '../../../../plan/planModel.js';

const level = activeLevel(DEFAULT_PLAN);
const withDoor = addOpening(level, 'wall-back', 'door', 'd1'); // 0.9 x 2.1, centered at 3 m: 2.55..3.45
const wallOf = (lvl) => lvl.walls.find((w) => w.id === 'wall-back');
const doorOf = (lvl) => wallOf(lvl).openings[0];
const parts = (lvl) => openingParts(wallOf(lvl), doorOf(lvl), 2.7);
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
const pocket2 = parts(updateOpening(updateOpening(withDoor, 'wall-back', 'd1', { width: 1.6, operation: 'pocket' }), 'wall-back', 'd1', { leaves: 4 }));
assert.equal(pocket2.leaves.length, 2, 'a pocket door has at most 2 leaves');
assert.ok(pocket2.leaves[0].leaf.min[2] === pocket2.leaves[1].leaf.min[2] && Math.abs((pocket2.leaves[0].leaf.min[2] + pocket2.leaves[0].leaf.max[2]) / 2 - (c0 + c1) / 2) < 1e-9, 'one track, on the axis');
assert.ok(pocket2.leaves[0].openShift < 0 && pocket2.leaves[1].openShift > 0, 'they part');
assert.equal(parts(updateOpening(withDoor, 'wall-back', 'd1', { operation: 'passage' })), null, 'a passage is just the hole');

// WINDOWS (default 1.2 x 1.4, sill 0.9, centered at 3 m: 2.4..3.6, 0.9..2.3)
const withWindow = addOpening(level, 'wall-back', 'window', 'w1');
const win = (patch) => openingParts(wallOf(withWindow), { ...doorOf(withWindow), ...patch }, 2.7);
const roomward = Math.sign(inner - outer);
// standard: one fixed sash on the axis, glass inside it, no handle, nothing moves
const fixed = win({});
assert.equal(fixed.leaves.length, 1);
const [pane] = fixed.leaves;
assert.ok(pane.openAngle === 0 && pane.openShift === 0 && pane.handle.length === 0, 'fixed');
assert.ok(Math.abs((pane.leaf.min[2] + pane.leaf.max[2]) / 2 - (c0 + c1) / 2) < 1e-9, 'on the axis');
assert.equal(pane.sash.length, 4);
assert.ok(inside(pane.glass, pane.leaf.min[0], pane.leaf.max[0], 0) && inside(pane.glass, pane.leaf.min[1], pane.leaf.max[1], 1), 'glass in the sash');
assert.ok(pane.leaf.min[1] > 0.9 + LINING && pane.leaf.max[1] < 2.3 - LINING, 'between the sill lining and the head');
// frame: jambs + head + inner casing (3) + bottom lining + inner sill + outer sill
assert.equal(fixed.frame.length, 3 + 3 + 3);
assert.ok(fixed.frame.some((b) => (roomward > 0 ? b.max[2] > c1 + 0.02 : b.min[2] < c0 - 0.02) && b.max[1] <= 0.9 + LINING + eps), 'inner sill juts into the room');
assert.ok(fixed.frame.every((b) => (roomward > 0 ? b.min[2] >= c0 - 0.05 : b.max[2] <= c1 + 0.05)), 'no casing outside: only the outer sill');
// hinged 2 leaves: open towards the swing side, handle on the room's side only, lever down
const casement = win({ operation: 'swing', leaves: 2 });
assert.ok(casement.leaves.every((l) => l.openAngle !== 0 && l.handle.length === 3), 'one handle (rose, stem, lever) each');
const lever = casement.leaves[0].handle[2];
assert.ok(lever.max[1] - lever.min[1] > lever.max[0] - lever.min[0], 'window lever points down');
assert.ok(casement.leaves[0].handle.every((b) => (roomward > 0 ? b.min[2] >= casement.leaves[0].leaf.max[2] - eps : b.max[2] <= casement.leaves[0].leaf.min[2] + eps)), 'handle on the room side');
// sliding window, 4 leaves sliding to the start: the first stays (no handle), the other 3 each on their own
// track slide onto its place; inside the faces, above the sill
const sliding = win({ operation: 'slide', leaves: 4 });
const at0 = sliding.leaves[0].leaf.min[0];
assert.ok(sliding.leaves[0].openShift === 0 && sliding.leaves[0].handle.length === 0, 'the fixed leaf');
assert.ok(sliding.leaves.slice(1).every((l) => l.handle.length === 1 && Math.abs(l.leaf.min[0] + l.openShift - at0) < 0.002), 'open: all over the fixed one');
assert.equal(new Set(sliding.leaves.map((l) => l.leaf.min[2].toFixed(4))).size, 4, 'four tracks');
assert.ok(sliding.leaves.every((l) => l.leaf.min[2] > c0 && l.leaf.max[2] < c1 && l.leaf.min[1] > 0.9), 'in the reveal, above the sill');
assert.equal(sliding.frame.length, 9, 'no rail');
const slidingEnd = win({ operation: 'slide', leaves: 2, hinge: 'end' });
assert.ok(slidingEnd.leaves[1].openShift === 0 && slidingEnd.leaves[0].openShift > 0, 'slides to the end: the last leaf stays');
// a window has no pocket: an old one is a sliding window
assert.deepEqual(win({ operation: 'pocket', leaves: 2 }), win({ operation: 'slide', leaves: 2 }));
// a hole is just the hole
assert.equal(win({ operation: 'hole' }), null);
// MATERIALS: the part's own, then the structure's (not for the handle), then the default
assert.equal(partMaterialId({}, 'd1', 'frame'), DEFAULT_PART_MATERIALS.frame);
const mats = { d1: 'oak', 'd1:leaf': 'paint:#ff0000' };
assert.equal(partMaterialId(mats, 'd1', 'frame'), 'oak', 'structure');
assert.equal(partMaterialId(mats, 'd1', 'leaf'), 'paint:#ff0000', 'own wins');
assert.equal(partMaterialId(mats, 'd1', 'handle'), DEFAULT_PART_MATERIALS.handle, 'the handle keeps its finish');
assert.equal(partMaterialId({ ...mats, 'd1:handle': 'oak' }, 'd1', 'handle'), 'oak');
console.log('doorModel: ok');

// FLUSH door: no casing, the lining behind the leaf, the leaf over the lining and flush with the swing face
{
    const flush = parts(updateOpening(withDoor, 'wall-back', 'd1', { operation: 'flush' }));
    assert.equal(flush.frame.length, 3, 'lining only (jambs + head), no casing');
    const [fl] = flush.leaves;
    assert.ok(Math.abs(fl.leaf.min[2] - c0) < eps, "swing 'in': flush with the face with the smaller c");
    assert.ok(fl.leaf.min[0] < 2.55 + LINING && fl.leaf.max[0] > 3.45 - LINING, 'leaf over the lining');
    for (const b of flush.frame) assert.ok(b.min[2] >= fl.leaf.max[2] - eps && Math.abs(b.max[2] - c1) < eps, 'lining from the leaf back to the other face');
    assert.ok(Math.abs(Math.abs(fl.openAngle) - Math.PI / 2) < eps && fl.openShift === 0, 'hinged');
    const flushOut = parts(updateOpening(withDoor, 'wall-back', 'd1', { operation: 'flush', swing: 'out' }));
    assert.ok(Math.abs(flushOut.leaves[0].leaf.max[2] - c1) < eps && flushOut.frame.every((b) => Math.abs(b.min[2] - c0) < eps), "swing 'out': mirrored");
    // PUSH: flush with the inner face (c0) but opening out: inside a full-depth lining, hinged at its back face
    const push = parts(updateOpening(withDoor, 'wall-back', 'd1', { operation: 'flush', swing: 'out', flushSide: 'in' }));
    const [pl] = push.leaves;
    assert.ok(Math.abs(pl.leaf.min[2] - c0) < eps, 'push: flush with the flush face, not the swing one');
    assert.ok(pl.leaf.min[0] >= 2.55 + LINING - eps && pl.leaf.max[0] <= 3.45 - LINING + eps, 'push: leaf inside the lining');
    assert.ok(push.frame.every((b) => Math.abs(b.min[2] - c0) < eps && Math.abs(b.max[2] - c1) < eps), 'push: full-depth lining');
    assert.ok(Math.abs(pl.hinge[1] - pl.leaf.max[2]) < eps, 'push: hinged at the back (swing-side) face');
    // opened 90°, every corner of the leaf is on the swing side of its flush face and clear of the lining
    for (const dx of [0, pl.leaf.max[0] - pl.leaf.min[0]]) for (const c of [pl.leaf.min[2], pl.leaf.max[2]]) {
        const [x, cc] = turn([dx, c - pl.hinge[1]], pl.openAngle);
        assert.ok(pl.hinge[0] + x >= 2.55 + LINING - eps && pl.hinge[1] + cc >= pl.hinge[1] - eps, 'push: opens through the reveal');
    }
}

// HANDLE STYLES (store partStyles): defaults per kind, a stored style only where that kind offers it
{
    const d = doorOf(withDoor);
    const hinged = (styles) => openingParts(wallOf(withDoor), d, 2.7, styles).leaves[0].handle;
    assert.equal(handleStyle({}, d), 'lever', 'hinged door: lever by default');
    assert.equal(hinged({}).length, 6, 'default lever unchanged: rose + stem + lever on both faces');
    assert.equal(hinged({ 'd1:handle': 'knob' }).length, 6, 'knob: rose + stem + knob on both faces');
    assert.equal(hinged({ 'd1:handle': 'bar' }).length, 6, 'bar: bar + 2 stems on both faces');
    assert.equal(hinged({ 'd1:handle': 'recessed' }).length, 2, 'recessed: one plate per face');
    assert.equal(hinged({ 'd1:handle': 'none' }).length, 0, 'none');
    const flushDoor = { ...d, operation: 'flush' };
    assert.equal(handleStyle({}, flushDoor), 'recessed', 'flush door: recessed by default');
    const pocketDoor = { ...d, operation: 'pocket' };
    assert.equal(handleStyle({ 'd1:handle': 'lever' }, pocketDoor), 'recessed', 'a style the kind does not offer: its default');
    assert.deepEqual(handleStyles({ type: 'door', operation: 'passage' }), [], 'a passage has no handle');
    assert.equal(handleStyle({}, { type: 'window' }), 'none', 'fixed window: none');
}
