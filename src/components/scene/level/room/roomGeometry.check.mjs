// Check for roomGeometry.js: node src/components/scene/level/room/roomGeometry.check.mjs
// Every face must point outwards and carry UVs = its position in meters along the face axes.
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { boxFaces, floorGeometry, mergeFaces, spherecastFaces, surfaceIdAt } from './roomGeometry.js';
import { Mesh, PlaneGeometry, Raycaster, Sphere } from 'three';

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
// merging: one geometry, and every triangle still maps to its face
const merged = mergeFaces([{ geometry: floor, surfaceId: 'floor' }, { geometry: faces.px, surfaceId: 'wall:inner' }]);
assert.equal(merged.geometry.index.count, floor.index.count + faces.px.index.count);
assert.equal(surfaceIdAt(merged.faceRanges, 0), 'floor');
assert.equal(surfaceIdAt(merged.faceRanges, 2), 'wall:inner');
assert.equal(surfaceIdAt(merged.faceRanges, 99), null);
// a ray onto the merged wall face reports a triangle of that face
const hit = new Raycaster(new Vector3(3, 2, 3), new Vector3(-1, 0, 0)).intersectObject(new Mesh(merged.geometry))[0];
assert.equal(surfaceIdAt(merged.faceRanges, hit.faceIndex), 'wall:inner');

// sphere pointers: per-face boxes, not the merged box (two walls 6 m apart: the middle touches nothing)
{
    const left = boxFaces([-3, 1, 0], [0.2, 2, 6]).px, right = boxFaces([3, 1, 0], [0.2, 2, 6]).nx;
    const walls = mergeFaces([{ geometry: left, surfaceId: 'left' }, { geometry: right, surfaceId: 'right' }]);
    const mesh = new Mesh(walls.geometry);
    mesh.updateMatrixWorld();
    const cast = (x) => { const hits = []; spherecastFaces(walls.faceRanges).call(mesh, new Sphere(new Vector3(x, 1, 0), 0.05), hits); return hits; };
    assert.equal(cast(0).length, 0);
    const hit = cast(2.88);
    assert.equal(hit.length, 1);
    assert.equal(surfaceIdAt(walls.faceRanges, hit[0].faceIndex), 'right');
    assert.ok(close(hit[0].point.x, 2.9) && close(hit[0].distance, 0.02));
}
{
    // a sloped face (attic roof pitch, eave at 1 m): a hand UNDER it is inside the face's box but far from
    // the face itself, so it must not touch it (it switched the right hand's ray off for good)
    const pitch = new PlaneGeometry(6, 4).rotateX(-Math.PI / 2).rotateZ(Math.atan2(3, 6)).translate(3, 2.5, 0);
    pitch.computeBoundingBox();
    const merged = mergeFaces([{ geometry: pitch, surfaceId: 'roof' }]);
    const mesh = new Mesh(merged.geometry);
    mesh.updateMatrixWorld();
    const cast = (x, y) => { const hits = []; spherecastFaces(merged.faceRanges).call(mesh, new Sphere(new Vector3(x, y, 0), 0.05), hits); return hits; };
    assert.ok(merged.faceRanges[0].box.containsPoint(new Vector3(3, 1.5, 0)));
    assert.equal(cast(3, 1.5).length, 0);
    assert.equal(cast(3, 2.47).length, 1); // touching the slope (2.5 m high there): still a hit
}
console.log('roomGeometry: ok');
