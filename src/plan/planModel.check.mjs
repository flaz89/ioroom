// Check for planModel.js: node src/plan/planModel.check.mjs
import assert from 'node:assert/strict';
import { DEFAULT_PLAN, addOpening, updateOpening, nominalMetersPerPixel, calibrateUnderlay, alignUnderlay, moveUnderlay, openingRects, removeOpening, addWall, closedLoops, rebuildFloors, flipWall, removeWall, splitWall, nearestVertex, activeLevel, levelBounds, levelVertices, moveVertex, polygonArea, setWallLength, updateWall, wallFootprint, wallFrame, withActiveLevel } from './planModel.js';

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
// an empty level: the default room's bounds (never infinite)
assert.ok(near(levelBounds({ ...level, walls: [], floors: [] }).center, [0, 0]));
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
// openings: centered in the widest free stretch; a second one goes into the widest gap left
const withWindow = addOpening(level, 'wall-back', 'window', 'o1');
assert.equal(withWindow.walls[1].openings[0].offset, 3);
const withTwo = addOpening(withWindow, 'wall-back', 'window', 'o2');
assert.ok(Math.abs(withTwo.walls[1].openings[1].offset - 1.2) < 1e-9); // gap 0..2.4
assert.equal(addOpening(updateWall(level, 'wall-back', { b: [-2.5, -3] }), 'wall-back', 'door'), null); // 0.5 m wall: no door
assert.equal(removeOpening(withTwo, 'wall-back', 'o1').walls[1].openings.length, 1);
// editing: valid patches apply, invalid ones (overlap, past the wall's end, through the top, too small) give null
assert.equal(updateOpening(withTwo, 'wall-back', 'o1', { width: 2 }).walls[1].openings[0].width, 2); // 2..4: free
assert.equal(updateOpening(withTwo, 'wall-back', 'o1', { offset: 2 }), null);      // 1.4..2.6 overlaps o2 (0.6..1.8)
assert.equal(updateOpening(withTwo, 'wall-back', 'o1', { offset: 5.5 }), null);    // past the end (6)
assert.equal(updateOpening(withTwo, 'wall-back', 'o1', { height: 1.8 }), null);    // 0.9 + 1.8 > 2.7 - 0.05
assert.equal(updateOpening(withTwo, 'wall-back', 'o1', { width: 0.1 }), null);
// clipped to the wall: a wall shortened to 3.2 m cuts the window (2.4..3.6) at 3.2, below a 5 cm lintel
const rect = openingRects(setWallLength(withWindow, 'wall-back', 3.2).walls[1], 2.2)[0];
assert.ok(Math.abs(rect.to - 3.2) < 1e-9 && Math.abs(rect.top - 2.15) < 1e-9);
// flip keeps the opening where it is in the world; split gives it to the piece holding its center
const shifted = updateWall(withWindow, 'wall-back', { openings: [{ ...withWindow.walls[1].openings[0], offset: 4 }] });
assert.equal(flipWall(shifted, 'wall-back').walls[1].openings[0].offset, 2);
const door = addOpening(level, 'wall-back', 'door', 'd1');
const flippedDoor = flipWall(flipWall(door, 'wall-back'), 'wall-back').walls[1].openings[0];
assert.ok(flippedDoor.hinge === 'start' && flippedDoor.swing === 'in'); // flipping twice: back to the defaults
assert.equal(flipWall(door, 'wall-back').walls[1].openings[0].hinge, 'end');
const pieces = splitWall(shifted, 'wall-back', 'w-new').walls;
assert.equal(pieces[1].openings.length, 0);
assert.equal(pieces[2].openings[0].offset, 1);
// underlay nominal scale: an A4 PDF page (595 pt wide) rendered 2 px per point, at 1:100 = 21 m wide
assert.ok(Math.abs(595 * 2 * nominalMetersPerPixel({ dpi: 72, downscale: 2, scale: 100 }) - 20.99) < 0.01);
// a 300 dpi scan of a 1:50 drawing, kept at full size: 1 px = 0.0254 / 300 * 50 m
assert.ok(Math.abs(nominalMetersPerPixel({ dpi: 300, downscale: 1, scale: 50 }) - 0.0254 / 6) < 1e-12);
// underlay tools: calibrate keeps the first point, align turns a line onto the nearest axis around its
// first point, move translates
const u0 = { metersPerPixel: 0.01, scale: 100, center: [2, 0], rotation: 0 };
const cal = calibrateUnderlay(u0, [0, 0], [1, 0], 3); // 1 m measured, really 3 m: x3 around (0, 0)
assert.ok(cal.scale === null && Math.abs(cal.metersPerPixel - 0.03) < 1e-12 && near(cal.center, [6, 0]));
assert.equal(calibrateUnderlay(u0, [1, 1], [1, 1], 2), null);
const aligned = alignUnderlay(u0, [0, 0], [1, 0.1]);   // ~5.7° below the horizontal: turned back to 0°
assert.ok(Math.abs(aligned.rotation + Math.atan2(0.1, 1)) < 1e-12);
assert.ok(Math.abs(aligned.center[1] - 2 * Math.sin(-Math.atan2(0.1, 1))) < 1e-12); // center turned around a
assert.ok(Math.abs(alignUnderlay(u0, [0, 0], [0.1, 1]).rotation - (Math.PI / 2 - Math.atan2(1, 0.1))) < 1e-12); // to vertical
assert.ok(near(moveUnderlay(u0, [1, 1], [3, 0]).center, [4, -1]));
// T on a split wall: the through walls stay square (no hole), the branch butts against their face
{
    const up = { id: 'up', a: [0, 0], b: [0, -2], thickness: 0.2 };   // split wall: up and down are collinear
    const down = { id: 'down', a: [0, 2], b: [0, 0], thickness: 0.2 };
    const branch = { id: 'br', a: [-3, 0], b: [0, 0], thickness: 0.2 };
    const t = [up, down, branch];
    const fu = wallFootprint(up, t), fd = wallFootprint(down, t), fb = wallFootprint(branch, t);
    // both through walls end square at the corner (z = 0 on both faces)
    for (const p of [fu.a, fu.aOut, fd.b, fd.bOut]) assert.ok(Math.abs(p[1]) < 1e-9, `through wall not square: ${p}`);
    // the branch ends on the through walls' face on the branch side (x = 0 or x = ±0.2, never a miter)
    assert.ok(Math.abs(fb.b[0] - fb.bOut[0]) < 1e-9, `branch end not square: ${fb.b} ${fb.bOut}`);
}
console.log('planModel: ok');
