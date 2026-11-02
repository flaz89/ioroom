// Check for mergeParts (loadModel.js): node src/models/loadModel.check.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeParts } from './loadModel.js';

// A glTF-like node: one mesh with two primitives (wood legs + fabric seat), the node rotated 90° around X
// (a GLB exported Z-up without baking) and moved away from the origin.
const wood = new THREE.MeshStandardMaterial({ name: 'wood' });
const fabric = new THREE.MeshStandardMaterial({ name: 'fabric' });
const node = new THREE.Group();
node.rotation.x = -Math.PI / 2; // Z up -> Y up
node.position.set(5, 2, -3);
const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.4).translate(0, 0, 0.2), wood);   // 40 cm tall along Z
const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1).translate(0, 0, 0.45), fabric); // on top, 10 cm
seat.geometry.deleteAttribute('uv'); // a part without UVs: the attribute is dropped from the merge
node.add(legs, seat);
const root = new THREE.Group();
root.add(node);

const { geometry, materials } = mergeParts(root);
const box = geometry.boundingBox;
const close = (a, b) => Math.abs(a - b) < 1e-6;
// one geometry, a group per material, same order
assert.deepEqual(materials.map((m) => m.name), ['wood', 'fabric']);
assert.deepEqual(geometry.groups.map((g) => g.materialIndex), [0, 1]);
// rotation baked: 50 cm tall along Y, 50 × 50 cm footprint
assert.ok(close(box.max.y - box.min.y, 0.5) && close(box.max.x - box.min.x, 0.5) && close(box.max.z - box.min.z, 0.5));
// origin at the center of the base
assert.ok(close(box.min.y, 0) && close(box.min.x, -box.max.x) && close(box.min.z, -box.max.z));
assert.ok(!geometry.attributes.uv && geometry.attributes.normal);
// BVH built without reordering the triangles: each group still holds its own part (the seat is on top)
assert.ok(geometry.boundsTree);
const seatGroup = geometry.groups[1];
for (let i = seatGroup.start; i < seatGroup.start + seatGroup.count; i++) {
    assert.ok(geometry.attributes.position.getY(geometry.index.getX(i)) > 0.39);
}
// the source parts are untouched (the GLB scene could be reused)
assert.ok(legs.geometry.attributes.uv);
console.log('loadModel: ok');
