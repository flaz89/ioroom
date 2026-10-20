// Check for planModel.js: node src/plan/planModel.check.mjs
import assert from 'node:assert/strict';
import { DEFAULT_PLAN, sceneBounds, addFloor, moveFloorVertex, removeFloor, floorAt, addOpening, openingFloors, openingLeaves, openingOperation, updateOpening, resizeOpening, openingClearances, nominalMetersPerPixel, calibrateUnderlay, alignUnderlay, moveUnderlay, openingRects, removeOpening, addWall, closedLoops, fillRoom, flipWall, removeWall, splitWall, nearestVertex, activeLevel, levelBounds, levelVertices, moveVertex, polygonArea, setWallLength, updateWall, wallFootprint, wallFrame, withActiveLevel, setWallJustify, faceOffsets } from './planModel.js';

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
assert.ok(near(moved.floors[0].points[0], [-3, -3])); // floors never follow the walls
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
// FILL A ROOM: the open U has no closed perimeter; closed, the clear area becomes a floor
const bare = { ...closed, floors: [] };
assert.equal(closedLoops(level.walls).length, 0);
assert.equal(fillRoom({ ...level, floors: [] }, [0, 0]), null);
const room = fillRoom(bare, [0, 0], 'floor');
assert.equal(room.floors.length, 1);
assert.equal(polygonArea(room.floors[0].points), 36);
assert.equal(fillRoom(room, [1, 1]), null); // already covered by a floor
assert.equal(fillRoom(bare, [10, 10]), null); // outside every room
// a middle wall ending on the front and back walls (T-joints) splits it into two rooms, filled one by one.
// Floors are CLEAR areas: the side-aligned partition (thickness towards +x) takes 0.15 x 6 off one room...
const areasOf = (lvl) => lvl.floors.map((floor) => +polygonArea(floor.points).toFixed(6)).sort((p, q) => p - q);
const fillBoth = (lvl) => fillRoom(fillRoom(lvl, [-1.5, 0], 'west'), [1.5, 0], 'east');
assert.deepEqual(areasOf(fillBoth(addWall(bare, [0, -3], [0, 3], 'mid'))), [17.1, 18]);
// a partition ending INSIDE the other walls' thickness (far face / between the faces), not on their lines,
// splits the room the same way (traced on a CAD drawing)
assert.deepEqual(areasOf(fillBoth(addWall(bare, [0, -3.15], [0, 3.05], 'mid'))), [17.1, 18]);
// ...a centered one half of it from each: two equal rooms
assert.deepEqual(areasOf(fillBoth(addWall(bare, [0, -3], [0, 3], 'mid', 'center'))), [17.55, 17.55]);
// opening the perimeter again: no room left to fill
assert.equal(fillRoom(removeWall(bare, 'wall-front'), [0, 0]), null);
// mixed thickness sides at a corner (one wall flipped): faces mitered pairwise, clean L corner
const mixed = [{ id: 'm1', a: [0, 0], b: [4, 0], thickness: 0.2 }, { id: 'm2', a: [4, 4], b: [4, 0], thickness: 0.2 }];
assert.ok(near(wallFootprint(mixed[0], mixed).b, [3.8, 0]) && near(wallFootprint(mixed[0], mixed).bOut, [4, -0.2]));
assert.ok(near(wallFootprint(mixed[1], mixed).b, [4, -0.2]) && near(wallFootprint(mixed[1], mixed).bOut, [3.8, 0]));
// openings: centered in the widest free stretch; a second one goes into the widest gap left
const withWindow = addOpening(level, 'wall-back', 'window', 'o1');
assert.equal(withWindow.walls[1].openings[0].offset, 3);
const withTwo = addOpening(withWindow, 'wall-back', 'window', 'o2');
assert.ok(Math.abs(withTwo.walls[1].openings[1].offset - 1.2) < 1e-9); // gap 0..2.4
assert.equal(addOpening(updateWall(level, 'wall-back', { b: [-2.5, -3] }), 'wall-back', 'door', 'd0').walls[1].openings[0].width, 0.5); // 0.5 m wall: a door that fills it
assert.equal(addOpening(updateWall(level, 'wall-back', { b: [-2.8, -3] }), 'wall-back', 'door'), null); // 0.2 m wall: no door
assert.equal(removeOpening(withTwo, 'wall-back', 'o1').walls[1].openings.length, 1);
// editing: valid patches apply, invalid ones (overlap, past the wall's end, through the top, too small) give null
assert.equal(updateOpening(withTwo, 'wall-back', 'o1', { width: 2 }).walls[1].openings[0].width, 2); // 2..4: free
assert.equal(updateOpening(withTwo, 'wall-back', 'o1', { offset: 2 }), null);      // 1.4..2.6 overlaps o2 (0.6..1.8)
assert.equal(updateOpening(withTwo, 'wall-back', 'o1', { offset: 5.5 }), null);    // past the end (6)
assert.equal(updateOpening(withTwo, 'wall-back', 'o1', { height: 1.8 }), null);    // 0.9 + 1.8 > 2.7 - 0.05
assert.equal(updateOpening(withTwo, 'wall-back', 'o1', { width: 0.1 }), null);
// resize handles (o1 2.4..3.6, o2 0.6..1.8, wall 6 m): one edge moves, clamped by the neighbor, the wall's end, the minimum size
const edge = (lvl) => { const o = lvl.walls[1].openings[0]; return [o.offset - o.width / 2, o.offset + o.width / 2].map((x) => Math.round(x * 1e6) / 1e6); };
assert.deepEqual(edge(resizeOpening(withTwo, 'wall-back', 'o1', 'start', 2)), [2, 3.6]);
assert.deepEqual(edge(resizeOpening(withTwo, 'wall-back', 'o1', 'start', 1)), [1.8, 3.6]);  // stops at o2
assert.deepEqual(edge(resizeOpening(withTwo, 'wall-back', 'o1', 'end', 10)), [2.4, 6]);     // stops at the wall's end
assert.deepEqual(edge(resizeOpening(withTwo, 'wall-back', 'o1', 'start', 3.5)), [3.3, 3.6]); // never below 30 cm
assert.equal(resizeOpening(withTwo, 'wall-back', 'gone', 'end', 4), null);
// clearances: o1 2.4..3.6 has o2 (ends at 1.8) before it, the wall's inner face end after (6: the back wall's
// inner face runs the whole 6 m line between the side walls' faces)
const gaps = openingClearances(withTwo, 'wall-back', 'o1');
assert.ok(Math.abs(gaps.before - 1.8) < 1e-9 && Math.abs(gaps.from - 2.4) < 1e-9 && Math.abs(gaps.to - 3.6) < 1e-9 && gaps.after > 3.6, JSON.stringify(gaps));
assert.equal(openingClearances(withTwo, 'wall-back', 'gone'), null);
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
// floor under a floor-level opening: the chosen side's room, flipped with its wall
{
    const room2 = fillRoom(fillRoom(addWall(bare, [0, -3], [0, 3], 'mid'), [-1.5, 0], 'floor'), [1.5, 0], 'east'); // west 'floor' | east 'east'
    const withDoor = addOpening(room2, 'mid', 'door', 'dd');
    const sideOf = (level) => openingFloors(level).find((p) => p.openingId === 'dd').floorId;
    const inner = sideOf(withDoor);
    const outerLevel = updateOpening(withDoor, 'mid', 'dd', { floorSide: 'out' });
    assert.notEqual(sideOf(outerLevel), inner);
    assert.equal(openingFloors(withDoor).length, 1);
    // a raised window has no floor strip
    assert.equal(openingFloors(addOpening(room2, 'mid', 'window', 'ww')).length, 0);
}

// leaves: equal widths; halves part in the middle, the odd middle leaf follows the hinge
{
    const sides = (opening) => openingLeaves(opening, 0, 1.2).map((leaf) => leaf.towardsStart);
    assert.deepEqual(sides({}), [true]);
    assert.deepEqual(sides({ hinge: 'end' }), [false]);
    assert.deepEqual(sides({ leaves: 2 }), [true, false]);
    assert.deepEqual(sides({ leaves: 3, hinge: 'end' }), [true, false, false]);
    assert.deepEqual(sides({ leaves: 4 }), [true, true, false, false]);
    const four = openingLeaves({ leaves: 4 }, 1, 2.2);
    assert.ok(Math.abs(four[1].from - 1.3) < 1e-9 && Math.abs(four[3].to - 2.2) < 1e-9);
    assert.equal(openingLeaves({ leaves: 9 }, 0, 1).length, 4); // clamped
}

// default operation: doors hinged, windows the standard symbol; an explicit one wins
assert.equal(openingOperation({ type: 'door' }), 'swing');
assert.equal(openingOperation({ type: 'window' }), 'standard');
assert.equal(openingOperation({ type: 'window', operation: 'slide' }), 'slide');

// LINE JUSTIFY: an L corner of axis walls (0.2 thick); the horizontal wall's line moved to a face keeps the wall
// in place (same faces) and the corner follows onto the vertical wall's line
{
    const lvl = { walls: [
        { id: 'h', a: [0, 0], b: [4, 0], thickness: 0.2, align: 'center' },
        { id: 'v', a: [4, 0], b: [4, 3], thickness: 0.2, align: 'center' }
    ], floors: [] };
    const faces = (w) => { const { normal } = wallFrame(w); const { inner, outer } = faceOffsets(w); return [inner, outer].map((o) => w.a[1] + normal[1] * o).sort(); };
    for (const justify of ['left', 'right']) {
        const next = setWallJustify(lvl, 'h', justify);
        const h = next.walls[0], v = next.walls[1];
        assert.deepEqual(faces(h).map((z) => z.toFixed(6)), faces(lvl.walls[0]).map((z) => z.toFixed(6)), `${justify}: faces stay`);
        assert.ok(near(h.b, v.a) && Math.abs(v.a[0] - 4) < 1e-9, `${justify}: corner on the vertical line`);
    }
    assert.equal(setWallJustify(setWallJustify(lvl, 'h', 'right'), 'h', 'center').walls[0].align, 'center');
}
// T ATTACH AT A WALL'S END: a wall ending on the far face of a corner wall, right where that wall ends, closes
// the room (the end attaches to the corner point)
{
    const box = [
        { id: 'top', a: [0, 0], b: [4, 0], thickness: 0.2, align: 'center' },
        { id: 'right', a: [4, 0], b: [4, 4], thickness: 0.2, align: 'center' },
        { id: 'bottom', a: [4, 4], b: [0, 4], thickness: 0.2, align: 'center' },
        { id: 'stub', a: [0, 4], b: [0, 2], thickness: 0.2, align: 'center' },  // left side, lower half
        { id: 'arm', a: [0, 2], b: [1, 2], thickness: 0.2, align: 'center' },   // corner stub + arm
        { id: 'door', a: [0, 1.9], b: [0, 0.1], thickness: 0.2, align: 'center' } // from the arm's face to the top face
    ];
    assert.equal(closedLoops(box).length >= 1, true, 'closed through the doorway');
}


// drawn floors (floor tool): closed polygon, either winding; invalid shapes refused
{
    const empty = { ...level, floors: [] };
    const square = addFloor(empty, [[0, 0], [2, 0], [2, 2], [0, 2]], 'f1');
    assert.equal(square.floors.length, 1);
    assert.equal(polygonArea(square.floors[0].points), 4);
    assert.ok(addFloor(empty, [[0, 0], [0, 2], [2, 2], [2, 0]]));             // counter-clockwise too
    assert.equal(addFloor(empty, [[0, 0], [2, 0], [2, 2], [2, 2], [0, 2]], 'f2').floors[0].points.length, 4); // duplicate dropped
    assert.equal(addFloor(empty, [[0, 0], [2, 0], [0, 2], [2, 2]]), null);   // bow tie: edges cross
    assert.equal(addFloor(empty, [[0, 0], [2, 0]]), null);                   // too few points
    assert.equal(addFloor(empty, [[0, 0], [1, 0], [2, 0]]), null);           // no area
    assert.ok(addFloor(empty, [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]])); // concave U
    // select / edit / delete
    assert.equal(floorAt(square, [1, 1]).id, 'f1');
    assert.equal(floorAt(square, [5, 5]), null);
    assert.equal(polygonArea(moveFloorVertex(square, 'f1', 2, [4, 2]).floors[0].points), 6);
    assert.equal(moveFloorVertex(square, 'f1', 2, [-2, 1]), null);              // crosses another edge
    assert.equal(moveFloorVertex(square, 'f1', 2, [2, 0]).floors[0].points.length, 3); // merges with a neighbour
    assert.equal(removeFloor(square, 'f1').floors.length, 0);
}

// T joint on an UNSPLIT wall: a partition ending on another wall's line (mid-length) butts on its face
{
    const through = { id: 'through', a: [0, 0], b: [6, 0], thickness: 0.2, align: 'center' };   // faces z = ±0.1
    const branch = { id: 'branch', a: [3, 2], b: [3, 0], thickness: 0.1, align: 'center' };     // ends on its line
    const f = wallFootprint(branch, [through, branch]);
    assert.ok(Math.abs(f.b[1] - 0.1) < 1e-9 && Math.abs(f.bOut[1] - 0.1) < 1e-9, `${f.b} ${f.bOut}`); // stops on the near face
    assert.equal(f.bJoined, true);
    assert.equal(f.aJoined, false);
    const t = wallFootprint(through, [through, branch]);                                           // the through wall is whole
    assert.ok(Math.abs(t.a[0]) < 1e-9 && Math.abs(t.b[0] - 6) < 1e-9 && !t.aJoined && !t.bJoined);
    // an end INSIDE the thickness, off the line (a wall traced to the axis, the other drawn on a face): same
    const offLine = { ...branch, b: [3, 0.05] };
    const fo = wallFootprint(offLine, [through, offLine]);
    assert.ok(Math.abs(fo.b[1] - 0.1) < 1e-9 && Math.abs(fo.bOut[1] - 0.1) < 1e-9 && fo.bJoined, `${fo.b} ${fo.bOut}`);
    // a side-aligned through wall (its line is the face on +z, thickness towards -z): a branch from +z stops on the line
    const side = { id: 'side', a: [0, 0], b: [6, 0], thickness: 0.2 };
    const fs = wallFootprint(branch, [side, branch]);
    assert.ok(Math.abs(fs.b[1]) < 1e-9 && Math.abs(fs.bOut[1]) < 1e-9, `${fs.b} ${fs.bOut}`);
}

// FILL A ROOM from footprints: walls that only overlap / touch (no shared corners), a hairline gap, a stub
{
    const c = (id, a, b, thickness = 0.2) => ({ id, a, b, thickness, align: 'center' });
    // a 4 x 3 room (axes), walls running past each other at the corners (crossing, no shared vertices)
    const crossing = { floors: [], walls: [c('n', [-0.5, 0], [4.5, 0]), c('s', [-0.5, 3], [4.5, 3]), c('w', [0, -0.5], [0, 3.5]), c('e', [4, -0.5], [4, 3.5])] };
    const room = fillRoom(crossing, [2, 1.5], 'f');
    assert.ok(Math.abs(polygonArea(room.floors[0].points) - 3.8 * 2.8) < 1e-6, `${polygonArea(room.floors[0].points)}`);
    // the east wall drawn 2 cm short of the north and south walls' faces: still closed (ROOM_GAP)
    const gap = { floors: [], walls: [c('n', [-0.1, 0], [4.1, 0]), c('s', [-0.1, 3], [4.1, 3]), c('w', [0, 0], [0, 3]), c('e', [4, 0.12], [4, 2.88])] };
    assert.ok(fillRoom(gap, [2, 1.5], 'f'));
    // a stub sticking into the room: the floor goes around it (area minus the stub's footprint)
    const stub = { ...crossing, walls: [...crossing.walls, c('stub', [2, 0], [2, 1], 0.1)] };
    assert.ok(Math.abs(polygonArea(fillRoom(stub, [1, 2], 'f').floors[0].points) - (3.8 * 2.8 - 0.1 * 0.93)) < 1e-6); // its free end run on by ROOM_GAP
    // inside a wall, or outside the building: nothing
    assert.equal(fillRoom(crossing, [0, 1.5]), null);
    assert.equal(fillRoom(crossing, [10, 10]), null);
}

// scene bounds: the plan alone, or grown to hold its underlay drawing (20 x 10 m, turned 90°, centered at x = 30)
{
    const plain = sceneBounds(level);
    assert.deepEqual(plain, levelBounds(level));
    const drawn = sceneBounds({ ...level, underlay: { width: 2000, height: 1000, metersPerPixel: 0.01, center: [30, 0], rotation: Math.PI / 2 } });
    assert.ok(Math.abs(drawn.max[0] - 35) < 1e-9 && Math.abs(drawn.max[1] - 10) < 1e-9 && drawn.min[0] < -3);
}

console.log('planModel: ok');
