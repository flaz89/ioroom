// Check for bakeAo.js: node src/components/scene/level/room/bakeAo.check.mjs
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { PAD, aoAtlas } from './aoAtlas.js';
import { bakeAo, bakeInput } from './bakeAo.js';
import { roomFaces } from './roomLayout.js';
import { DEFAULT_PLAN, activeLevel } from '../../../../plan/planModel.js';

// the 6 x 6 test room (walls' inner faces at x, z = +-3; no wall in front: z = +3 is open)
const faces = roomFaces(activeLevel(DEFAULT_PLAN));
const atlas = aoAtlas(faces.map((face) => face.geometry));
const started = performance.now();
const ao = bakeAo(atlas.size, bakeInput(atlas.geometries));
const ms = performance.now() - started;
assert.equal(ao.length, atlas.size * atlas.size);

// AO (0..1) at a point of a face, read through that face's chart
const floor = faces.findIndex((face) => face.surfaceId === 'floor');
function aoAt(face, point) {
    const p = new Vector3(...point);
    const chart = atlas.charts.find((c) => c.face === face && Math.abs(p.clone().sub(c.origin).dot(c.normal)) < 1e-6);
    const rel = p.clone().sub(chart.origin);
    const x = Math.floor(chart.x + PAD + rel.dot(chart.u) / atlas.texel);
    const y = Math.floor(chart.y + PAD + rel.dot(chart.v) / atlas.texel);
    return ao[y * atlas.size + x] / 255;
}
const center = aoAt(floor, [0, 0, 0]);
const byWall = aoAt(floor, [-2.97, 0, 0]);        // at the left wall's foot, mid wall
const corner = aoAt(floor, [-2.97, 0, -2.97]);    // the back-left corner: two walls
const open = aoAt(floor, [0, 0, 2.97]);           // front edge: no wall there
console.log(`  center ${center.toFixed(2)}, by a wall ${byWall.toFixed(2)}, corner ${corner.toFixed(2)}, open edge ${open.toFixed(2)}`);
assert.ok(center > 0.97, 'the middle of the floor is open');
assert.ok(byWall < center - 0.15, 'darker at the foot of a wall');
assert.ok(corner < byWall - 0.1, 'darker still in a corner');
assert.ok(open > 0.95, 'no wall, no darkening');

// a wall's inner face, low and in the middle: darkened by the floor
const leftWall = faces.findIndex((face) => face.surfaceId === 'wall-left:inner');
const wallFoot = aoAt(leftWall, [-3, 0.03, 0]);
const wallMid = aoAt(leftWall, [-3, 1.35, 0]);
assert.ok(wallFoot < wallMid - 0.15, `wall darker at its foot (${wallFoot.toFixed(2)} vs ${wallMid.toFixed(2)})`);

// the border fill: every chart's PAD margin next to its texels is filled (no 255 halo around a dark corner)
const chart = atlas.charts.find((c) => c.face === floor);
const inside = ao[(chart.y + PAD) * atlas.size + chart.x + PAD];
const margin = ao[(chart.y + PAD - 1) * atlas.size + chart.x + PAD - 1];
assert.ok(Math.abs(inside - margin) < 40, `margin filled from the chart (${inside} vs ${margin})`);

console.log(`  ${atlas.size} px atlas baked in ${ms.toFixed(0)} ms`);
console.log('bakeAo: ok');
