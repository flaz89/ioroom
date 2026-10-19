// node src/plan/traceWall.check.mjs — assisted wall tracing (traceWall.js) on synthetic drawings
import assert from 'node:assert/strict';
import { joinTracedWall, traceWall } from './traceWall.js';
import { closedLoops, roomPolygon, polygonArea } from './planModel.js';

const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;
const close = (a, b) => Math.abs(a - b) < 1e-9;

// A 6 x 4 m room (inner faces) with 30 cm walls, drawn as a CAD plan: outer and inner rectangles; the
// bottom wall (z = 4) has a 90 cm door from x = 2 to 2.9 (both faces interrupted)
const rect = (x0, z0, x1, z1) => [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]];
const segments = [
    ...rect(0, 0, 6, 4).filter(([p, q]) => !(p[1] === 4 && q[1] === 4)),
    ...rect(-0.3, -0.3, 6.3, 4.3).filter(([p, q]) => !(p[1] === 4.3 && q[1] === 4.3)),
    [[6, 4], [2.9, 4]], [[2, 4], [0, 4]],                // inner face of the bottom wall, split by the door
    [[6.3, 4.3], [2.9, 4.3]], [[2, 4.3], [-0.3, 4.3]],   // outer face, split too
    [[2, 4], [2, 4.3]], [[2.9, 4], [2.9, 4.3]]           // jambs
];

// top wall, pointed on its inner face: center line at z = -0.15 over the inner face's length
const top = traceWall([3, 0.01], segments, 0.05);
assert.ok(close(top.thickness, 0.3));
assert.ok(near(top.a, [0, -0.15]) && near(top.b, [6, -0.15]), `${top.a} ${top.b}`);
// the same wall pointed on its OUTER face: same wall (the overlap of both faces)
const topOut = traceWall([3, -0.31], segments, 0.05);
assert.ok(close(topOut.thickness, 0.3));
assert.ok([topOut.a, topOut.b].every((p) => close(p[1], -0.15)));
assert.ok(close(Math.abs(topOut.b[0] - topOut.a[0]), 6));
// left wall
const left = traceWall([0.01, 2], segments, 0.05);
assert.ok(close(left.thickness, 0.3) && [left.a, left.b].every((p) => close(p[0], -0.15)));
// bottom wall: the click picks the stretch on its side of the door
const west = traceWall([1, 4.01], segments, 0.05);
assert.ok(close(Math.min(west.a[0], west.b[0]), 0) && close(Math.max(west.a[0], west.b[0]), 2));
const east = traceWall([4, 4.29], segments, 0.05);
assert.ok(close(Math.min(east.a[0], east.b[0]), 2.9) && close(Math.max(east.a[0], east.b[0]), 6));
// a face drawn in several touching pieces is one face
const pieces = [[[0, 0], [2, 0]], [[2, 0], [3.5, 0]], [[3.5, 0], [6, 0]], [[0, -0.2], [6, -0.2]]];
const merged = traceWall([1, 0], pieces, 0.05);
assert.ok(close(Math.abs(merged.b[0] - merged.a[0]), 6) && close(merged.thickness, 0.2));
// a face broken by a 9 cm frame detail (both faces) is still one wall; a 90 cm door is not bridged
const broken = [[[0, 0], [2, 0]], [[2.09, 0], [5, 0]], [[0, -0.2], [2, -0.2]], [[2.09, -0.2], [5, -0.2]]];
const bridged = traceWall([1, 0], broken, 0.05);
assert.ok(close(Math.abs(bridged.b[0] - bridged.a[0]), 5));
// a door frame at the wall's end: the lower face starts at the frame (x = 2), the masonry jamb crosses the
// whole wall at x = 2.07, a frame line at x = 2 covers only part of it: the wall starts at the masonry
{
    const framed = [
        [[0, 0], [6, 0]],                       // upper face (runs on across the door: threshold line)
        [[2, 0.15], [6, 0.15]],                 // lower face, from the frame
        [[2.07, 0], [2.07, 0.15]],              // masonry jamb: across the whole wall
        [[2, 0.05], [2, 0.15]]                  // frame: partial
    ];
    const wall = traceWall([4, 0.15], framed, 0.05);
    assert.ok(close(Math.min(wall.a[0], wall.b[0]), 2.07) && close(Math.max(wall.a[0], wall.b[0]), 6), `${wall.a} ${wall.b}`);
}
// nothing pointed / a lone line / lines too far apart: no wall
assert.equal(traceWall([3, 2], segments, 0.05), null);
assert.equal(traceWall([1, 0], [[[0, 0], [6, 0]]], 0.05), null);
assert.equal(traceWall([1, 0], [[[0, 0], [6, 0]], [[0, 1], [6, 1]]], 0.05), null);
// a slanted wall (30°) is traced in its own direction
const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
const turn = ([x, z]) => [x * c - z * s, x * s + z * c];
const slanted = traceWall(turn([2, 0]), [[turn([0, 0]), turn([4, 0])], [turn([0, 0.25]), turn([4, 0.25])]], 0.05);
assert.ok(close(slanted.thickness, 0.25) && close(Math.hypot(slanted.b[0] - slanted.a[0], slanted.b[1] - slanted.a[1]), 4));

// JOINS: tracing the four walls of the room one by one closes it (L corners on the axes)
{
    const empty = { walls: [], floors: [] };
    let plan = joinTracedWall(empty, top, 'top');
    assert.ok(near(plan.walls[0].a, [0, -0.15]));                      // nothing to join yet
    plan = joinTracedWall(plan, left, 'left');                          // L: both meet at (-0.15, -0.15)
    const leftWall = plan.walls.find((w) => w.id === 'left'), topWall = plan.walls.find((w) => w.id === 'top');
    assert.ok([leftWall.a, leftWall.b].some((p) => near(p, [-0.15, -0.15])), `${leftWall.a} ${leftWall.b}`);
    assert.ok([topWall.a, topWall.b].some((p) => near(p, [-0.15, -0.15])));
    assert.equal(joinTracedWall(plan, traceWall([3, 0.01], segments, 0.05)), null); // traced twice
    plan = joinTracedWall(plan, traceWall([5.99, 2], segments, 0.05), 'right');
    plan = joinTracedWall(plan, west, 'west');
    plan = joinTracedWall(plan, east, 'east');
    assert.equal(plan.walls.length, 5);
    // the bottom pieces end at the corners and at the door jambs (2 and 2.9 on the axis z = 4.15)
    const bottom = ['west', 'east'].map((id) => plan.walls.find((w) => w.id === id)).flatMap((w) => [w.a, w.b]).map((p) => +p[0].toFixed(6)).sort((p, q) => p - q);
    assert.deepEqual(bottom, [-0.15, 2, 2.9, 6.15]);
    // a T: a partition traced between the top and bottom inner faces ends on their axes
    const partition = joinTracedWall(plan, { a: [3, 0], b: [3, 4], thickness: 0.1 }, 'mid');
    const mid = partition.walls.find((w) => w.id === 'mid');
    assert.ok(near(mid.a, [3, -0.15]) && near(mid.b, [3, 4.15]), `${mid.a} ${mid.b}`);
    // with the door gap closed by hand (one bottom wall), the traced room is a closed perimeter: 6 x 4 clear
    const closedRoom = joinTracedWall(joinTracedWall(joinTracedWall(joinTracedWall(empty, top, 't'), left, 'l'),
        traceWall([5.99, 2], segments, 0.05), 'r'), { a: [0, 4.15], b: [6, 4.15], thickness: 0.3 }, 'b');
    const loops = closedLoops(closedRoom.walls);
    assert.equal(loops.length, 1);
    assert.ok(Math.abs(polygonArea(roomPolygon(loops[0], closedRoom.walls)) - 24) < 1e-6);
}

// a piece shorter than the corner it makes (e.g. on a pillar's section): one face would be 2 cm long, refused
{
    const one = joinTracedWall({ walls: [], floors: [] }, { a: [0, 0], b: [4, 0], thickness: 0.3 }, 'w1');
    assert.equal(joinTracedWall(one, { a: [4, 0.17], b: [4, 0.05], thickness: 0.3 }, 'stub'), null);
    assert.ok(joinTracedWall(one, { a: [4, 1], b: [4, 0.05], thickness: 0.3 }, 'long')); // a real L corner is fine
}

// T joint in the drawing: the upper face runs on, the lower one is broken where a wall joins from below
{
    const t = [[[0, 0], [6, 0]], [[0, 0.3], [2.5, 0.3]], [[3, 0.3], [6, 0.3]], [[2.5, 0.3], [2.5, 3]], [[3, 0.3], [3, 3]]];
    const wall = traceWall([2.75, 0.01], t, 0.05);
    assert.ok(wall && close(wall.thickness, 0.3) && close(Math.abs(wall.b[0] - wall.a[0]), 6), `${wall?.a} ${wall?.b}`);
}
// L corner with another wall already at that corner (a wall running on): the corner is not moved
{
    const base = { walls: [
        { id: 'v', a: [0, -3], b: [0, 0], thickness: 0.2, align: 'center' },
        { id: 'h', a: [0, 0], b: [5, 0], thickness: 0.2, align: 'center' }
    ], floors: [] };
    const joined = joinTracedWall(base, { a: [-3, 0.05], b: [-0.1, 0.05], thickness: 0.2 }, 'new');
    assert.deepEqual(joined.walls.find((w) => w.id === 'h').a, [0, 0]);
    assert.deepEqual(joined.walls.find((w) => w.id === 'v').b, [0, 0]);
}

console.log('traceWall: ok');
