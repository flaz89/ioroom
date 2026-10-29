// Check for aoAtlas.js: node src/components/scene/level/room/aoAtlas.check.mjs
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { AO_TEXEL, PAD, aoAtlas } from './aoAtlas.js';
import { roomFaces } from './roomLayout.js';
import { boxFaces, mergeFaces } from './roomGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEFAULT_PLAN, activeLevel, addFloor, addOpening, setCeilingHeight, setCeilingRoof, setRoofRidgeHeight } from '../../../../plan/planModel.js';

const base = activeLevel(DEFAULT_PLAN);
// the 6 x 6 room with a window and a door, under a gable roof (eaves 2.5 m, ridge 4.5 m): every kind of face
const holed = addOpening(addOpening(base, 'wall-back', 'window', 'o1'), 'wall-back', 'door', 'o2');
const roofed = setRoofRidgeHeight(setCeilingHeight(setCeilingRoof(addFloor(holed, [[-3, -3], [3, -3], [3, 3], [-3, 3]], 'c', 'ceilings'), 'c', 'gable'), 'c', 2.5), 'c', 4.5);

for (const level of [base, roofed]) {
    const faces = roomFaces(level);
    const sources = faces.map((face) => face.geometry);
    const atlas = aoAtlas(sources);
    const { size, texel, charts } = atlas;
    assert.ok(size >= 64 && size <= 2048 && (size & (size - 1)) === 0, `power of two: ${size}`);
    assert.equal(texel, AO_TEXEL, 'the 6 x 6 room fits without growing the texel');

    // same triangles, same attributes + uv1 (mergeFaces needs them all alike)
    atlas.geometries.forEach((geometry, i) => {
        assert.equal(geometry.index.count, sources[i].index.count);
        assert.deepEqual(Object.keys(geometry.attributes).sort(), [...Object.keys(sources[i].attributes), 'uv1'].sort());
    });
    mergeFaces(atlas.geometries.map((geometry, i) => ({ geometry, surfaceId: faces[i].surfaceId })));

    // rects inside the atlas, never overlapping
    for (const [i, a] of charts.entries()) {
        assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= size && a.y + a.h <= size, 'inside the atlas');
        for (const b of charts.slice(i + 1)) {
            assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'no overlap');
        }
    }

    // every vertex: uv1 inside its chart's inner area (the PAD margin stays free), and the chart's mapping
    // gives back the vertex's position (the projection is exact: charts are planar)
    const p = new Vector3();
    atlas.geometries.forEach((geometry, face) => {
        const uv1 = geometry.attributes.uv1;
        const position = geometry.attributes.position;
        const own = charts.filter((chart) => chart.face === face);
        for (let i = 0; i < uv1.count; i++) {
            const px = uv1.getX(i) * size, py = uv1.getY(i) * size;
            p.fromBufferAttribute(position, i);
            const chart = own.find((c) => px >= c.x + PAD - 1e-6 && px <= c.x + c.w - PAD + 1e-6 && py >= c.y + PAD - 1e-6 && py <= c.y + c.h - PAD + 1e-6
                && Math.abs(p.clone().sub(c.origin).dot(c.normal)) < 1e-6);
            assert.ok(chart, `vertex ${i} of face ${faces[face].surfaceId} in one of its charts`);
            const back = chart.origin.clone().addScaledVector(chart.u, (px - chart.x - PAD) * texel).addScaledVector(chart.v, (py - chart.y - PAD) * texel);
            assert.ok(back.distanceTo(p) < 1e-4, `uv1 maps back to the position (${back.distanceTo(p)})`);
        }
    });

    console.log(`  ${faces.length} faces, ${charts.length} charts, atlas ${size} px at ${texel * 100} cm`);
}

// one geometry holding several planes (a box's 6 sides merged, like a raised floor with its sides): 6 charts
const box = mergeGeometries(Object.values(boxFaces([0, 0.5, 0], [2, 1, 3])));
assert.equal(aoAtlas([box]).charts.length, 6, 'split by plane');

// a big plan grows the atlas, then the texel, never past 2048 px
const big = aoAtlas(roomFaces(addFloor(base, [[-60, -60], [60, -60], [60, 60], [-60, 60]], 'huge')).map((face) => face.geometry));
assert.ok(big.size === 2048 && big.texel > AO_TEXEL, `${big.size} px at ${big.texel}`);
console.log('aoAtlas: ok');
