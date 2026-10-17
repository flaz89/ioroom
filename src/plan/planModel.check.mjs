// Check for planModel.js: node src/plan/planModel.check.mjs
import assert from 'node:assert/strict';
import { DEFAULT_PLAN, activeLevel, levelBounds, levelVertices, moveVertex, polygonArea, setWallLength, updateWall, wallFootprint, wallFrame, withActiveLevel } from './planModel.js';

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
// corners: 3 walls in a U = 4 distinct end points
assert.equal(levelVertices(level).length, 4);
// moving the back-left corner moves both walls' ends and the floor point, nothing else
const moved = moveVertex(level, [-3, -3], [-4, -3.5]);
assert.ok(near(moved.walls[0].b, [-4, -3.5]) && near(moved.walls[1].a, [-4, -3.5]));
assert.ok(near(moved.walls[2].a, [3, -3]));
assert.ok(near(moved.floors[0].points[0], [-4, -3.5]));
assert.ok(near(level.walls[0].b, [-3, -3])); // the original level is untouched
// a wall can not collapse onto its other end
assert.equal(moveVertex(level, [-3, -3], [-3, 3]), null);
// only the active level is replaced
assert.equal(withActiveLevel(DEFAULT_PLAN, moved).levels[0], moved);
// length: the back wall (a = (-3,-3) -> b = (3,-3)) set to 8 m moves b to (5,-3); the right wall follows
const longer = setWallLength(level, 'wall-back', 8);
assert.ok(near(longer.walls[1].b, [5, -3]) && near(longer.walls[2].a, [5, -3]));
assert.ok(near(longer.walls[1].a, [-3, -3])); // start fixed
assert.equal(setWallLength(level, 'wall-back', 0), null);
// patch one wall only
const thick = updateWall(level, 'wall-left', { thickness: 0.3 });
assert.equal(thick.walls[0].thickness, 0.3);
assert.equal(thick.walls[1], level.walls[1]);
console.log('planModel: ok');
