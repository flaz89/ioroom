// Check for planModel.js: node src/plan/planModel.check.mjs
import assert from 'node:assert/strict';
import { DEFAULT_PLAN, activeLevel, levelBounds, polygonArea, wallFootprint, wallFrame } from './planModel.js';

const level = activeLevel(DEFAULT_PLAN);
const [left, back, right] = level.walls;
const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;
// outward normals: left wall towards -x, back towards -z, right towards +x
assert.ok(near(wallFrame(left).normal, [-1, 0]) && near(wallFrame(back).normal, [0, -1]) && near(wallFrame(right).normal, [1, 0]));
// mitered corners: back-left outer corner shared at (-3.15, -3.15)
const fLeft = wallFootprint(left, level.walls), fBack = wallFootprint(back, level.walls);
assert.ok(near(fLeft.bOut, [-3.15, -3.15]) && near(fBack.aOut, [-3.15, -3.15]));
assert.equal(fLeft.bJoined, true);
// open end of the left wall (towards the viewer): free, square end
assert.equal(fLeft.aJoined, false);
assert.ok(near(fLeft.aOut, [-3.15, 3]));
// oblique join (45°): the outer corner is where the outer lines meet
const walls = [{ id: 'w1', a: [0, 0], b: [4, 0], thickness: 0.2 }, { id: 'w2', a: [4, 0], b: [8, 4], thickness: 0.2 }];
const f1 = wallFootprint(walls[0], walls), f2 = wallFootprint(walls[1], walls);
assert.ok(near(f1.bOut, f2.aOut), `${f1.bOut} vs ${f2.aOut}`);
assert.equal(polygonArea(level.floors[0].points), 36);
const bounds = levelBounds(level);
assert.ok(near(bounds.min, [-3.15, -3.15]) && near(bounds.max, [3.15, 3]));
console.log('planModel: ok');
