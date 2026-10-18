// Check for dxfWalls.js: node src/plan/dxfWalls.check.mjs
import assert from 'node:assert/strict';
import { wallCandidates } from './dxfWalls.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const mm = 0.001; // drawing in millimeters

// a 4000 mm wall, 300 thick, along x: its inner face drawn in two pieces (merged), the outer one reversed
const straight = wallCandidates([
    0, 0, 2500, 0,
    2500, 0, 4000, 0,
    4000, 300, 0, 300
], mm);
assert.equal(straight.length, 1, 'one wall');
assert.ok(near(straight[0].thickness, 300), 'thickness');
assert.ok(near(straight[0].a[1], 150) && near(straight[0].b[1], 150), 'center line');
assert.ok(near(Math.abs(straight[0].b[0] - straight[0].a[0]), 4000), 'full length');

// a gap in both faces: ONE wall with an opening (900 wide, 1000 from its start); a door without context
const gapFaces = [0, 0, 1000, 0, 1900, 0, 4000, 0, 0, 120, 1000, 120, 1900, 120, 4000, 120];
const joined = wallCandidates(gapFaces, mm);
assert.equal(joined.length, 1, 'joined across the gap');
assert.ok(near(Math.abs(joined[0].b[0] - joined[0].a[0]), 4000), 'continuous wall');
const [gap] = joined[0].openings;
assert.ok(joined[0].openings.length === 1 && near(gap.from, joined[0].a[0] < joined[0].b[0] ? 1000 : 2100) && near(gap.to - gap.from, 900), 'opening');
assert.equal(gap.kind, 'door', 'door by default');
// glass lines inside the wall thickness across the gap: a window; a door layer beside it: a door
assert.equal(wallCandidates(gapFaces, mm, { context: [{ name: 'A-GLAZ-X', segments: [] }, { name: 'X', segments: [1000, 50, 1900, 50, 1000, 70, 1900, 70] }] })[0].openings[0].kind, 'window', 'window');
assert.equal(wallCandidates(gapFaces, mm, { context: [{ name: 'A-DOOR', segments: [1000, -20, 1900, -20] }] })[0].openings[0].kind, 'door', 'door layer');
// a gap wider than 3 m: two walls; a different thickness across the gap: two walls
assert.equal(wallCandidates([0, 0, 1000, 0, 4500, 0, 6000, 0, 0, 120, 1000, 120, 4500, 120, 6000, 120], mm).length, 2, 'wide gap');
assert.equal(wallCandidates([0, 0, 1000, 0, 1900, 0, 4000, 0, 0, 120, 1000, 120, 1900, 300, 4000, 300], mm).length, 2, 'other thickness');

// too thin (2 mm detail lines), too far (a 3 m room between two walls), too short an overlap: no walls
assert.equal(wallCandidates([0, 0, 1000, 0, 0, 2, 1000, 2], mm).length, 0, 'thin');
assert.equal(wallCandidates([0, 0, 1000, 0, 0, 3000, 1000, 3000], mm).length, 0, 'far');
assert.equal(wallCandidates([0, 0, 1000, 0, 900, 200, 2000, 200], mm).length, 0, 'short overlap');

// three parallel lines: only the neighbors pair (outer pair blocked by the middle line)
assert.equal(wallCandidates([0, 0, 1000, 0, 0, 100, 1000, 100, 0, 200, 1000, 200], mm).length, 2, 'blocked outer pair');

// slanted 30° wall in meters, opposite drawing directions
const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
const slanted = wallCandidates([0, 0, 3 * c, 3 * s, 3 * c - 0.2 * s, 3 * s + 0.2 * c, -0.2 * s, 0.2 * c], 1);
assert.equal(slanted.length, 1, 'slanted wall');
assert.ok(near(slanted[0].thickness, 0.2, 1e-4), 'slanted thickness');

// L CORNER (both walls stop at the inner corner, 200 thick): both ends reach the other's center line
const corner = wallCandidates([
    0, 0, 3000, 0, 0, 200, 2800, 200,           // horizontal wall, z 0..200, x 0..3000 (outer face longer)
    2800, 200, 2800, 3000, 3000, 0, 3000, 3000  // vertical wall, x 2800..3000
], mm);
assert.equal(corner.length, 2, 'two corner walls');
const horizontal = corner.find((w) => near(w.a[1], w.b[1]));
assert.ok(near(Math.max(horizontal.a[0], horizontal.b[0]), 2900), 'corner: reaches the vertical center line');
const vertical = corner.find((w) => !near(w.a[1], w.b[1]));
assert.ok(near(Math.min(vertical.a[1], vertical.b[1]), 100), 'corner: both walls end on the same point (mitered by the plan model)');
assert.equal(horizontal.openings.length, 0, 'no opening at the corner');

// T JOINT: a 120 wall joins a 200 wall from below; the through wall's lower face is interrupted -> no opening
const tee = wallCandidates([
    0, 0, 4000, 0, 0, 200, 1940, 200, 2060, 200, 4000, 200, // through wall (lower face split by the joint)
    1940, 200, 1940, 2000, 2060, 200, 2060, 2000             // branch wall
], mm);
const through = tee.find((w) => near(w.a[1], w.b[1]));
assert.equal(through.openings.length, 0, 'T joint is not an opening');
const branch = tee.find((w) => !near(w.a[1], w.b[1]));
assert.ok(near(Math.min(branch.a[1], branch.b[1]), 200), 'branch stops on the through wall face (no penetration)');

// DOOR AT A WALL'S END: the branch stops 900 before the through wall, a door frame drawn in the gap ->
// extended, with a 900 door; the same gap left empty is an open passage (the end stays free)
const endFaces = [
    0, 0, 4000, 0, 0, 200, 4000, 200,
    1940, 1100, 1940, 3000, 2060, 1100, 2060, 3000
];
const frame = [{ name: '0', segments: [1960, 230, 2040, 230, 1960, 1070, 2040, 1070] }];
const passage = wallCandidates(endFaces, mm, { context: frame.map(() => ({ name: '0', segments: [] })) }).find((w) => !near(w.a[1], w.b[1]));
assert.equal(passage.openings.length, 0, 'empty gap: no door');
assert.ok(near(Math.min(passage.a[1], passage.b[1]), 1100), 'empty gap: end stays free');
const endDoor = wallCandidates(endFaces, mm, { context: frame }).find((w) => !near(w.a[1], w.b[1]));
assert.equal(endDoor.openings.length, 1, 'end door');
assert.ok(near(endDoor.openings[0].to - endDoor.openings[0].from, 900), 'end door width');
assert.equal(endDoor.openings[0].kind, 'door');
const doorStart = Math.min(endDoor.a[1], endDoor.b[1]);
assert.ok(near(doorStart, 200), 'extended up to the through wall face');
// the door lies between the through wall's face (z 200) and the old end (z 1100), whichever end `a` is
const along = (t) => endDoor.a[1] + ((endDoor.b[1] - endDoor.a[1]) / Math.abs(endDoor.b[1] - endDoor.a[1])) * t;
const doorZ = [along(endDoor.openings[0].from), along(endDoor.openings[0].to)].sort((p, q) => p - q);
assert.ok(near(doorZ[0], 200) && near(doorZ[1], 1100), `door position ${doorZ}`);

// WINDOW NEXT TO A T JOINT: the through wall's inner face is interrupted from the joint (x 1940..2060) to the
// window's end (x 3000): the joint stretch is dropped, the 940 window beside it stays
const besideJoint = wallCandidates([
    0, 0, 4000, 0,                                   // outer face, continuous (the window is only on the inside here)
    0, 200, 1940, 200, 3000, 200, 4000, 200,          // inner face: joint + window gap
    1940, 200, 1940, 2000, 2060, 200, 2060, 2000      // joining wall
], mm, { context: [{ name: 'X', segments: [2060, 100, 3000, 100] }] }).find((w) => near(w.a[1], w.b[1]));
assert.equal(besideJoint.openings.length, 1, 'window beside the joint');
assert.ok(near(besideJoint.openings[0].to - besideJoint.openings[0].from, 940, 15), `window width ${besideJoint.openings[0].to - besideJoint.openings[0].from}`);
assert.equal(besideJoint.openings[0].kind, 'window');

console.log('dxfWalls: ok');
