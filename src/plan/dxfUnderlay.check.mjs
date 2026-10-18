// Check for dxfUnderlay.js: node src/plan/dxfUnderlay.check.mjs
// The input mimics dxf-parser's output (arc angles in radians, INSERT rotation in degrees).
import assert from 'node:assert/strict';
import { dxfVectors, dxfUnitsGuess } from './dxfUnderlay.js';

const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
const dxf = {
    header: { $INSUNITS: 4 },
    entities: [
        // a 4000 x 3000 mm room outline (closed polyline) on WALLS
        { type: 'LWPOLYLINE', layer: 'WALLS', shape: true, vertices: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] },
        // a door block inserted at (1000, 0), rotated 90°, scaled 2
        { type: 'INSERT', layer: 'DOORS', name: 'DOOR', position: { x: 1000, y: 0 }, rotation: 90, xScale: 2, yScale: 2 },
        { type: 'TEXT', layer: 'TEXT', text: 'ignored' }
    ],
    blocks: {
        // block entities on layer "0" take the INSERT's layer; base point (10, 0)
        DOOR: { position: { x: 10, y: 0 }, entities: [{ type: 'LINE', layer: '0', vertices: [{ x: 10, y: 0 }, { x: 110, y: 0 }] }] }
    }
};
const { units, width, height, layers } = dxfVectors(dxf);
assert.equal(units, 'mm');
assert.equal(width, 4000);
assert.equal(height, 3000);
assert.deepEqual(layers.map((l) => l.name), ['DOORS', 'WALLS']); // TEXT skipped, block line on DOORS
// closed polyline: 4 segments; centered (center 2000, 1500), y flipped: CAD (0, 0) -> plan (-2000, 1500)
const walls = layers.find((l) => l.name === 'WALLS').segments;
assert.equal(walls.length, 16);
assert.deepEqual(walls.slice(0, 4), [-2000, 1500, 2000, 1500]);
// door: base point at the insert position, 200 long (scale 2), towards +Y (rotation 90) -> plan -Z
const door = layers.find((l) => l.name === 'DOORS').segments;
assert.ok(near(door[0], -1000) && near(door[1], 1500) && near(door[2], -1000) && near(door[3], 1300), String(door));

// bulge: a semicircle from (0, 0) to (2, 0) bulging below (bulge 1 = 180° counter-clockwise), plus arc and circle
const curves = dxfVectors({
    entities: [
        { type: 'LWPOLYLINE', layer: 'A', vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 2, y: 0 }] },
        { type: 'CIRCLE', layer: 'B', center: { x: 1, y: 0 }, radius: 1 }
    ]
});
const arc = curves.layers.find((l) => l.name === 'A').segments;
const last = arc.length - 2;
assert.ok(near(arc[0], -1) && near(arc[last], 1) && near(arc[last + 1], 0), 'arc ends on the polyline points');
// counter-clockwise from (0, 0) to (2, 0) around (1, 0) passes below: CAD y = -1 -> plan z = +1
assert.ok(Math.max(...arc.filter((_, i) => i % 2 === 1)) > 0.99, 'bulge goes below');
assert.equal(curves.units, 'm'); // no $INSUNITS, 2 units wide: meters
assert.equal(dxfUnitsGuess(12000), 'mm');
assert.equal(dxfUnitsGuess(1200), 'cm');
assert.throws(() => dxfVectors({ entities: [] }), /No lines/);
// a stray line far away does not move the center: 1000 short lines around (0, 0) + one at (1e6, 1e6)
const many = Array.from({ length: 1000 }, (_, i) => ({ type: 'LINE', layer: 'A', vertices: [{ x: i % 10, y: 0 }, { x: i % 10, y: 10 }] }));
const stray = dxfVectors({ header: { $INSUNITS: 6 }, entities: [...many, { type: 'LINE', layer: 'B', vertices: [{ x: 1e6, y: 1e6 }, { x: 1e6 + 1, y: 1e6 }] }] });
const first = stray.layers.find((l) => l.name === 'A').segments;
assert.ok(Math.abs(first[0] + 4.5) < 1e-6 && Math.abs(first[1] - 5) < 1e-6, String(first.slice(0, 2))); // (0, 0) -> centered on (4.5, 5)
assert.ok(stray.width < 10, String(stray.width));
console.log('dxfUnderlay ok');
