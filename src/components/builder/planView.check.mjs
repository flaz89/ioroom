// Check for planView.js: node src/components/builder/planView.check.mjs
import assert from 'node:assert/strict';
import { fitView, toWorld, zoomAt, panBy, gridSteps, MAX_SCALE } from './planView.js';

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
console.log('planView.check: ok');
