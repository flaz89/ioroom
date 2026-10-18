// Check for planView.js: node src/components/builder/planView.check.mjs
import assert from 'node:assert/strict';
import { fitView, toWorld, zoomAt, panBy, gridSteps, alignPoint, angleSnap, angleBetween, wallsInBox, rulerSnap2D, lockToPlanAxis, underlayTargets, snapWithUnderlay, NO_TARGETS, planMeasureList, MAX_SCALE } from './planView.js';

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
// ruler snap: a corner wins over an edge, an edge over nothing
const segs = [[[0, 0], [4, 0]]];
assert.deepEqual(rulerSnap2D([3.95, 0.05], [[4, 0]], segs, 0.1), { point: [4, 0], kind: 'vertex' });
assert.equal(rulerSnap2D([2, 0.05], [[4, 0]], segs, 0.1).kind, 'edge');
assert.equal(rulerSnap2D([2, 1], [[4, 0]], segs, 0.1).kind, null);
// axis lock: along Z from (1, 3) to a slanted wall face from (0, 0) to (4, 1): crosses it at z = 0.25
const locked = lockToPlanAxis([1, 3], [1.2, 0.3], { point: [1.2, 0.3], kind: 'edge', segment: [[0, 0], [4, 1]] });
assert.equal(locked.axis, 'z');
assert.ok(Math.abs(locked.point[0] - 1) < 1e-9 && Math.abs(locked.point[1] - 0.25) < 1e-9);
// measures from above: true 3D length; a vertical one (a point from above) is hidden
const seen = planMeasureList({ items: [{ id: 'v', a: [0, 0, 0], b: [0, 2.7, 0] }], local: [{ id: 'h', a: { p: [0, 0, 0] }, b: { p: [3, 0, 4] } }] });
assert.equal(seen.length, 1);
assert.equal(seen[0].length, 5);
// a vertex is projected on the axis
assert.deepEqual(lockToPlanAxis([0, 0], [5, 0.4], { point: [5, 0.4], kind: 'vertex' }).point, [5, 0]);
// CAD underlay targets: 1 unit = 1 cm, turned 90° clockwise on screen, centered on (10, 0)
const cadUnderlay = { metersPerPixel: 0.01, rotation: Math.PI / 2, center: [10, 0], hiddenLayers: ['OFF'] };
const cad = underlayTargets(cadUnderlay, [{ name: 'WALLS', segments: [0, 0, 100, 0] }, { name: 'OFF', segments: [0, 0, 0, 500] }]);
assert.equal(cad.segments.length, 1); // hidden layer skipped
const [ca, cb] = cad.segments[0];
assert.ok(Math.hypot(ca[0] - 10, ca[1]) < 1e-9 && Math.hypot(cb[0] - 10, cb[1] - 1) < 1e-9, `${ca} ${cb}`); // +x turned to +z, 1 m long
// priority: plan corner > CAD end > plan edge > CAD line
const own = { vertices: [[10.05, 0.5]], segments: [[[9.9, 0.3], [10.1, 0.3]]] };
assert.deepEqual(snapWithUnderlay([10.04, 0.5], own, cad, 0.1), { point: [10.05, 0.5], kind: 'vertex' });
assert.equal(snapWithUnderlay([10.02, 0.98], own, cad, 0.1).cad, true);          // CAD end (10, 1)
assert.equal(snapWithUnderlay([10.02, 0.98], own, cad, 0.1).kind, 'vertex');
assert.equal(snapWithUnderlay([10.08, 0.3], own, cad, 0.1).cad, undefined);       // plan edge beats the CAD line
const onLine = snapWithUnderlay([10.03, 0.7], NO_TARGETS, cad, 0.1);
assert.ok(onLine.cad && onLine.kind === 'edge' && Math.abs(onLine.point[0] - 10) < 1e-9 && onLine.segment);
assert.equal(snapWithUnderlay([12, 0.7], own, cad, 0.1).kind, null);

console.log('planView.check: ok');
