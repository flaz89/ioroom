// Check for planView.js: node src/components/builder/planView.check.mjs
import assert from 'node:assert/strict';
import { fitView, toWorld, zoomAt, panBy, gridSteps, alignPoint, angleSnap, angleBetween, wallsInBox, MAX_SCALE } from './planView.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// fit: 6 x 6 m level + 1 m margin each side = 8 m in 800 px -> 100 px/m, centered
const view = fitView({ min: [-3, -3], max: [3, 3], center: [0, 0] }, 800, 600);
near(view.scale, 75); // limited by the height: 600 / 8
near(view.cx, 0);

// the view center is the view's world center
const [x, z] = toWorld(view, 800, 600, 400, 300);
near(x, 0); near(z, 0);

// zooming keeps the point under the cursor still
const zoomed = zoomAt(view, 800, 600, 100, 50, 3);
const before = toWorld(view, 800, 600, 100, 50), after = toWorld(zoomed, 800, 600, 100, 50);
near(before[0], after[0]); near(before[1], after[1]);
assert.equal(zoomAt(view, 800, 600, 0, 0, 1e9).scale, MAX_SCALE);

// panning right moves the world left
assert.ok(panBy(view, 75, 0).cx < view.cx);

// grid: 100 px/m -> 10 cm minor (10 px), 1 m major
assert.deepEqual(gridSteps(100), { minor: 0.1, major: 1 });
assert.equal(gridSteps(10).minor, 1);
// alignment: x lines up with (2, 5), z with (-1, 3); far targets ignored
const aligned = alignPoint([2.04, 2.97], [[2, 5], [-1, 3], [10, 10]], 0.1);
assert.deepEqual(aligned.point, [2, 3]);
assert.equal(aligned.guides.length, 2);
assert.equal(alignPoint([0.5, 0.5], [[2, 5]], 0.1).guides.length, 0);
// angle snap: 44° from the X axis with a 15° step -> on the 45° ray (projected: x = z)
const snapped45 = angleSnap([0, 0], [Math.cos(44 * Math.PI / 180) * 2, Math.sin(44 * Math.PI / 180) * 2], 0, 15, 2);
near(snapped45.angle, Math.PI / 4); near(snapped45.point[0], snapped45.point[1]);
assert.equal(angleSnap([0, 0], [1, Math.tan(38 * Math.PI / 180)], 0, 15, 2), null); // 38°: too far from 30/45
// relative to a previous wall going along +X: 91° -> square (90°)
const square = angleSnap([0, 0], [0.02, 1], 0, 90, 3);
near(square.point[0], 0);
// angle between walls at a corner
near(angleBetween([0, 0], [1, 0], [0, 1]), 90);
near(angleBetween([0, 0], [-1, 0], [1, 0]), 180);
// box selection: window = fully inside, crossing = touched too (even with both ends outside)
const boxWalls = [{ id: 'in', a: [1, 1], b: [2, 1] }, { id: 'half', a: [1, 2], b: [5, 2] }, { id: 'through', a: [-1, 1.5], b: [5, 1.5] }, { id: 'out', a: [8, 8], b: [9, 8] }];
assert.deepEqual(wallsInBox(boxWalls, [0, 0], [3, 3], false), ['in']);
assert.deepEqual(wallsInBox(boxWalls, [3, 3], [0, 0], true), ['in', 'half', 'through']);
console.log('planView.check: ok');
