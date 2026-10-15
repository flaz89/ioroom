// Check for roomGeometry.js: node src/components/scene/level/room/roomGeometry.check.mjs
// Every face must point outwards and carry UVs = its position in meters along the face axes.
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { boxFaces, floorGeometry } from './roomGeometry.js';

const close = (a, b) => Math.abs(a - b) < 1e-6;
const faces = boxFaces([1, 2, 3], [0.2, 2.7, 6]);
const expected = { px: [1, 0, 0], nx: [-1, 0, 0], py: [0, 1, 0], ny: [0, -1, 0], pz: [0, 0, 1], nz: [0, 0, -1] };
for (const [name, geometry] of Object.entries(faces)) {
    const normal = new Vector3().fromBufferAttribute(geometry.attributes.normal, 0);
    assert.ok(normal.distanceTo(new Vector3(...expected[name])) < 1e-6, `${name} normal ${normal.toArray()}`);
    const p = new Vector3().fromBufferAttribute(geometry.attributes.position, 0);
    const [u, v] = [geometry.attributes.uv.getX(0), geometry.attributes.uv.getY(0)];
    const want = { px: [-p.z, p.y], nx: [p.z, p.y], py: [p.x, -p.z], ny: [p.x, p.z], pz: [p.x, p.y], nz: [-p.x, p.y] }[name];
    assert.ok(close(u, want[0]) && close(v, want[1]), `${name} uv ${u},${v} != ${want}`);
}
// the +X face sits on the box side: x = center + half size
assert.ok(close(new Vector3().fromBufferAttribute(faces.px.attributes.position, 0).x, 1.1));
// floor: 1 m apart along x = 1 unit of u
const floor = floorGeometry(6, 6);
const uv = floor.attributes.uv, pos = floor.attributes.position;
assert.ok(close(uv.getX(1) - uv.getX(0), pos.getX(1) - pos.getX(0)));
console.log('roomGeometry: ok');
