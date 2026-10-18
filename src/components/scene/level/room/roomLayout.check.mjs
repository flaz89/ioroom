// Check for roomLayout.js: node src/components/scene/level/room/roomLayout.check.mjs
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { roomFaces, surfaceAreas, surfaceLabel } from './roomLayout.js';
import { DEFAULT_PLAN, activeLevel, addOpening } from '../../../../plan/planModel.js';

const level = activeLevel(DEFAULT_PLAN);
const areas = surfaceAreas(level);
const near = (a, b) => Math.abs(a - b) < 0.011;
assert.ok(near(areas.floor, 36));
// inside faces: exactly what the room sees
assert.ok(near(areas['wall-back:inner'], 6 * 2.7) && near(areas['wall-left:inner'], 6 * 2.7));
// outside of the back wall: mitered at both corners, 6.30 m long
assert.ok(near(areas['wall-back:outer'], 6.3 * 2.7), `${areas['wall-back:outer']}`);
// left wall edge: top trapezoid (6.15 + 6) / 2 x 0.15 + its open end 0.15 x 2.7
assert.ok(near(areas['wall-left:edge'], (6.15 + 6) / 2 * 0.15 + 0.15 * 2.7), `${areas['wall-left:edge']}`);
// a window (1.2 x 1.4) and a door (0.9 x 2.1) on the back wall (0.15 thick): holes off both faces, reveals on the edge
const holed = addOpening(addOpening(level, 'wall-back', 'window', 'o1'), 'wall-back', 'door', 'o2');
const holedAreas = surfaceAreas(holed);
const holes = 1.2 * 1.4 + 0.9 * 2.1;
assert.ok(near(holedAreas['wall-back:inner'], 6 * 2.7 - holes), `${holedAreas['wall-back:inner']}`);
assert.ok(near(holedAreas['wall-back:outer'], 6.3 * 2.7 - holes));
// reveals: window jambs + head + sill, door jambs + head (no threshold: the room's floor fills the door's depth)
assert.ok(near(holedAreas['wall-back:edge'] - areas['wall-back:edge'], (2 * (1.4 + 1.2) + 2 * 2.1 + 0.9) * 0.15));
assert.ok(near(holedAreas.floor, 36 + 0.9 * 0.15), `${holedAreas.floor}`);
// the floor's geometry has the strip: it reaches the back wall's outer face (z = -3.15) under the door
const holedFloor = roomFaces(holed).find((face) => face.surfaceId === 'floor').geometry;
holedFloor.computeBoundingBox();
assert.ok(Math.abs(holedFloor.boundingBox.min.z + 3.15) < 1e-6, `${holedFloor.boundingBox.min.z}`);
// floorSide 'out' with no floor outside: the room's floor still fills it (nothing else could)
const outside = { ...holed, walls: holed.walls.map((w) => (w.id === 'wall-back' ? { ...w, openings: w.openings.map((o) => ({ ...o, floorSide: 'out' })) } : w)) };
assert.ok(near(surfaceAreas(outside).floor, 36 + 0.9 * 0.15));
// no floor on either side (no floors at all): the threshold is back
const bare = surfaceAreas({ ...holed, floors: [] });
assert.ok(near(bare['wall-back:edge'] - areas['wall-back:edge'], 2 * (1.4 + 1.2 + 2.1 + 0.9) * 0.15));
// every face: normal attribute agrees with the triangle winding (front faces outwards / inwards as declared)
for (const face of [...roomFaces(level), ...roomFaces(holed)]) {
    const { position, normal } = face.geometry.attributes;
    const index = face.geometry.index;
    for (let t = 0; t < index.count; t += 3) {
        const p = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(position, index.getX(t + k)));
        const winding = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));
        assert.ok(winding.dot(new Vector3().fromBufferAttribute(normal, index.getX(t))) > 0, `${face.key} winding`);
    }
    assert.ok(face.geometry.attributes.uv != null && index != null, `${face.key} attributes`);
}
// the back wall inner face faces the room (+z) and its UVs run in meters along x
const inner = roomFaces(level).find((face) => face.surfaceId === 'wall-back:inner');
assert.ok(new Vector3().fromBufferAttribute(inner.geometry.attributes.normal, 0).equals(new Vector3(0, 0, 1)));
assert.equal(surfaceLabel('wall-right:outer', level), 'Right wall · outside');
assert.equal(surfaceLabel('floor', level), 'Floor');
console.log('roomLayout: ok');
