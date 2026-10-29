// Check for bakeAo.js: node src/components/scene/level/room/bakeAo.check.mjs
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { PAD, aoAtlas } from './aoAtlas.js';
import { bakeAo, bakeInput, bakeTexels, finishBoth, mergeRows } from './bakeAo.js';
import { roomFaces } from './roomLayout.js';
import { DEFAULT_PLAN, activeLevel, addFloor, setCeilingHeight, setCeilingRoof, setRoofRidgeHeight } from '../../../../plan/planModel.js';

// AO (0..1) at a point of a face of `atlas`, read through that face's chart
function reader(atlas, data) {
    return (face, point) => {
        const p = new Vector3(...point);
        const chart = atlas.charts.find((c) => c.face === face && Math.abs(p.clone().sub(c.origin).dot(c.normal)) < 1e-6);
        const rel = p.clone().sub(chart.origin);
        const x = Math.floor(chart.x + PAD + rel.dot(chart.u) / atlas.texel);
        const y = Math.floor(chart.y + PAD + rel.dot(chart.v) / atlas.texel);
        return data[y * atlas.size + x] / 255;
    };
}

// the 6 x 6 test room (walls' inner faces at x, z = +-3; no wall in front: z = +3 is open)
const level = activeLevel(DEFAULT_PLAN);
const faces = roomFaces(level);
const atlas = aoAtlas(faces.map((face) => face.geometry));
const started = performance.now();
const { ao, aoOpen } = bakeAo(atlas.size, bakeInput(atlas.geometries));
const ms = performance.now() - started;
assert.equal(ao.length, atlas.size * atlas.size);
assert.deepEqual(aoOpen, ao, 'no ceilings: both versions alike');
const aoAt = reader(atlas, ao);

const floor = faces.findIndex((face) => face.surfaceId === 'floor');
const center = aoAt(floor, [0, 0, 0]);
const byWall = aoAt(floor, [-2.97, 0, 0]);        // at the left wall's foot, mid wall
const corner = aoAt(floor, [-2.97, 0, -2.97]);    // the back-left corner: two walls
const open = aoAt(floor, [0, 0, 2.97]);           // front edge: no wall there
console.log(`  center ${center.toFixed(2)}, by a wall ${byWall.toFixed(2)}, corner ${corner.toFixed(2)}, open edge ${open.toFixed(2)}`);
assert.ok(center > 0.97, 'the middle of the floor is open');
assert.ok(byWall < center - 0.1, 'darker at the foot of a wall');
assert.ok(corner < byWall - 0.05, 'darker still in a corner');
assert.ok(open > 0.95, 'no wall, no darkening');
// close to the edge only (no "soft box" band along every wall: 29/10 on the Quest)
assert.ok(aoAt(floor, [-2.4, 0, 0]) > 0.98, 'open again 60 cm from a wall');

// a wall's inner face, low and in the middle: darkened by the floor
const leftWall = faces.findIndex((face) => face.surfaceId === 'wall-left:inner');
const wallFoot = aoAt(leftWall, [-3, 0.03, 0]);
const wallMid = aoAt(leftWall, [-3, 1.35, 0]);
assert.ok(wallFoot < wallMid - 0.1, `wall darker at its foot (${wallFoot.toFixed(2)} vs ${wallMid.toFixed(2)})`);

// the border fill: every chart's PAD margin next to its texels is filled (no 255 halo around a dark corner)
const chart = atlas.charts.find((c) => c.face === floor);
const inside = ao[(chart.y + PAD) * atlas.size + chart.x + PAD];
const margin = ao[(chart.y + PAD - 1) * atlas.size + chart.x + PAD - 1];
assert.ok(Math.abs(inside - margin) < 40, `margin filled from the chart (${inside} vs ${margin})`);

// split by interleaved rows over 3 workers, merged: the same atlas as one bake
const parts = [0, 1, 2].map((rowOffset) => bakeTexels(atlas.size, bakeInput(atlas.geometries), { rowOffset, rowStride: 3 }));
assert.deepEqual(finishBoth(atlas.size, mergeRows(atlas.size, parts)), { ao, aoOpen }, 'rows split and merged = one bake');

// CEILINGS: the room under a gable roof (eaves 2.5 m, ridge 4.5 m). The top of a wall under the eave is darkened by
// the roof; in the version without the ceilings (tabletop, "Hide ceiling") it is not
const roofed = setRoofRidgeHeight(setCeilingHeight(setCeilingRoof(addFloor(level, [[-3, -3], [3, -3], [3, 3], [-3, 3]], 'c', 'ceilings'), 'c', 'gable'), 'c', 2.5), 'c', 4.5);
const roofedFaces = roomFaces(roofed);
const roofedAtlas = aoAtlas(roofedFaces.map((face) => face.geometry));
const isCeiling = roofedFaces.map((face) => face.surfaceId === 'c' || face.surfaceId.startsWith('c~'));
assert.ok(isCeiling.some(Boolean), 'the roof has faces');
const both = bakeAo(roofedAtlas.size, bakeInput(roofedAtlas.geometries, isCeiling));
const roofedWall = roofedFaces.findIndex((face) => face.surfaceId === 'wall-back:inner');
const top = [0, 2.45, -3];
const withRoof = reader(roofedAtlas, both.ao)(roofedWall, top);
const withoutRoof = reader(roofedAtlas, both.aoOpen)(roofedWall, top);
console.log(`  wall top under the eave: ${withRoof.toFixed(2)} with the roof, ${withoutRoof.toFixed(2)} without`);
assert.ok(withRoof < 0.9 && withoutRoof > 0.97, 'the roof\'s AO goes with the roof');
// low on the same wall: the roof is out of reach, both versions agree
assert.ok(Math.abs(reader(roofedAtlas, both.ao)(roofedWall, [0, 0.8, -3]) - reader(roofedAtlas, both.aoOpen)(roofedWall, [0, 0.8, -3])) < 0.01);

console.log(`  ${atlas.size} px atlas baked in ${ms.toFixed(0)} ms`);
console.log('bakeAo: ok');
