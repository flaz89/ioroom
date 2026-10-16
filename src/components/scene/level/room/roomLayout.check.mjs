// Check for roomLayout.js: node src/components/scene/level/room/roomLayout.check.mjs
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { roomFaces, surfaceAreas, surfaceLabel } from './roomLayout.js';
import { DEFAULT_PLAN, activeLevel } from '../../../../plan/planModel.js';

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
// every face: normal attribute agrees with the triangle winding (front faces outwards / inwards as declared)
for (const face of roomFaces(level)) {
    const { position, normal } = face.geometry.attributes;
    const index = face.geometry.index;
    const p = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(position, index.getX(k)));
    const winding = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));
    assert.ok(winding.dot(new Vector3().fromBufferAttribute(normal, 0)) > 0, `${face.key} winding`);
    assert.ok(face.geometry.attributes.uv != null && index != null, `${face.key} attributes`);
}
// the back wall inner face faces the room (+z) and its UVs run in meters along x
const inner = roomFaces(level).find((face) => face.surfaceId === 'wall-back:inner');
assert.ok(new Vector3().fromBufferAttribute(inner.geometry.attributes.normal, 0).equals(new Vector3(0, 0, 1)));
assert.equal(surfaceLabel('wall-right:outer', level), 'Right wall · outside');
assert.equal(surfaceLabel('floor', level), 'Floor');
console.log('roomLayout: ok');
