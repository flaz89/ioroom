// Check for planModel.js: node src/plan/planModel.check.mjs
import assert from 'node:assert/strict';
import { DEFAULT_PLAN, addWall, closedLoops, rebuildFloors, flipWall, removeWall, splitWall, nearestVertex, activeLevel, levelBounds, levelVertices, moveVertex, polygonArea, setWallLength, updateWall, wallFootprint, wallFrame, withActiveLevel } from './planModel.js';

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
// a new wall closing the U joins both open corners (its ends equal theirs) and is drawn clockwise:
// right (3,3) -> left (-3,3) on screen, thickness towards +z (outside the room)
const closed = addWall(level, [3, 3], [-3, 3], 'wall-front');
const front = closed.walls[3];
assert.ok(near(wallFrame(front).normal, [0, 1]));
const fFront = wallFootprint(front, closed.walls);
assert.equal(fFront.aJoined && fFront.bJoined, true);
assert.equal(addWall(level, [0, 0], [0.01, 0]), null);
// vertex snap: within the distance only
assert.ok(near(nearestVertex(level, [2.9, -2.95], 0.2), [3, -3]));
assert.equal(nearestVertex(level, [0, 0], 0.2), null);
// flip: same line, thickness on the other side (back wall: outward normal -z -> +z)
const flipped = flipWall(level, 'wall-back').walls[1];
assert.ok(near(wallFrame(flipped).normal, [0, 1]));
assert.ok(near(flipped.a, [3, -3]) && near(flipped.b, [-3, -3]));
// remove
assert.equal(removeWall(level, 'wall-left').walls.length, 2);
// split at the middle: first keeps id and start, second starts at the middle and ends at b; joined
const split = splitWall(level, 'wall-back', 'wall-back-2');
const [half1, half2] = [split.walls[1], split.walls[2]];
assert.equal(half1.id, 'wall-back');
assert.ok(near(half1.a, [-3, -3]) && near(half1.b, [0, -3]) && near(half2.a, [0, -3]) && near(half2.b, [3, -3]));
assert.equal(half2.name, undefined);
assert.equal(wallFootprint(half1, split.walls).bJoined, true);
// FLOORS: the open U has no loop (its manual floor is kept); closed, the loop takes over the 'floor' id
assert.equal(closedLoops(level.walls).length, 0);
assert.equal(rebuildFloors(level).level.floors[0].id, 'floor');
const room = rebuildFloors(closed).level;
assert.equal(room.floors.length, 1);
assert.equal(room.floors[0].id, 'floor');
assert.equal(room.floors[0].auto, true);
assert.equal(polygonArea(room.floors[0].points), 36);
// a middle wall ending on the front and back walls (T-joints) splits it: the second room inherits.
// Floors are CLEAR areas: the side-aligned partition (thickness towards +x) takes 0.15 x 6 off one room...
const halves = rebuildFloors(addWall(room, [0, -3], [0, 3], 'mid'), () => 'new-floor');
assert.deepEqual(halves.level.floors.map((floor) => +polygonArea(floor.points).toFixed(6)), [18, 17.1]);
assert.deepEqual(halves.inherited, { 'new-floor': 'floor' });
// ...a centered one half of it from each: two equal rooms
const centered = rebuildFloors(addWall(room, [0, -3], [0, 3], 'mid', 'center'), () => 'new-floor');
assert.deepEqual(centered.level.floors.map((floor) => +polygonArea(floor.points).toFixed(6)), [17.55, 17.55]);
// mixed thickness sides at a corner (one wall flipped): faces mitered pairwise, clean L corner
const mixed = [{ id: 'm1', a: [0, 0], b: [4, 0], thickness: 0.2 }, { id: 'm2', a: [4, 4], b: [4, 0], thickness: 0.2 }];
assert.ok(near(wallFootprint(mixed[0], mixed).b, [3.8, 0]) && near(wallFootprint(mixed[0], mixed).bOut, [4, -0.2]));
assert.ok(near(wallFootprint(mixed[1], mixed).b, [4, -0.2]) && near(wallFootprint(mixed[1], mixed).bOut, [3.8, 0]));
// opening the perimeter again drops the auto floor
const reopened = rebuildFloors(removeWall(room, 'wall-front'));
assert.equal(reopened.level.floors.length, 0);
assert.deepEqual(reopened.removed, ['floor']);
console.log('planModel: ok');
