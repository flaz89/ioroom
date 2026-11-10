// Check for mergeParts (loadModel.js): node src/models/loadModel.check.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeParts, mirroredGeometry } from './loadModel.js';

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
// MIRROR: x flipped, footprint and groups kept, faces still outward (normal of each triangle from its
// winding agrees with the vertex normals), cached
const mirror = mirroredGeometry(geometry);
assert.equal(mirroredGeometry(geometry), mirror);
assert.deepEqual(mirror.groups, geometry.groups);
assert.ok(Math.abs(mirror.boundingBox.min.x + geometry.boundingBox.max.x) < 1e-6);
assert.ok(mirror.boundsTree);
const [pa, pb, pc] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const face = new THREE.Vector3(), vertexNormal = new THREE.Vector3();
for (let i = 0; i < mirror.index.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => mirror.index.getX(i + k));
    pa.fromBufferAttribute(mirror.attributes.position, a);
    pb.fromBufferAttribute(mirror.attributes.position, b);
    pc.fromBufferAttribute(mirror.attributes.position, c);
    face.subVectors(pc, pb).cross(pa.clone().sub(pb));
    if (face.lengthSq() < 1e-12) continue;
    vertexNormal.fromBufferAttribute(mirror.attributes.normal, a);
    assert.ok(face.dot(vertexNormal) > 0, 'mirrored triangle faces outward');
}
// MOVING PARTS: a `move_` node with a slide (Blender axes) stays apart, slide converted to three.js axes;
// body and part share the same centering (the part keeps its place relative to the body)
{
    const mat = new THREE.MeshStandardMaterial({ name: 'fabric' });
    const scene = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 1).translate(10, 0.2, 0), mat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.2).translate(10, 0.65, -0.4), mat);
    back.name = 'move_back';
    back.userData.slide = [0, -0.3, 0]; // Blender -Y = toward the front (three +Z)
    const noSlide = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(11.1, 0.1, 0), mat);
    noSlide.name = 'move_broken'; // no slide: body
    scene.add(body, back, noSlide);
    const merged = mergeParts(scene);
    assert.equal(merged.parts.length, 1);
    const [part] = merged.parts;
    assert.equal(part.name, 'move_back');
    assert.deepEqual(part.slide.map((v) => v + 0), [0, 0, 0.3]);
    assert.equal(part.materials.length, 1);
    assert.equal(merged.materials.length, 2, 'body + the move_ node without slide');
    // centered on the whole piece (x 9..11.2 -> center 10.1), the part keeps its offset from the body
    assert.ok(Math.abs(part.geometry.boundingBox.min.x + 1.1) < 1e-6);
    assert.ok(Math.abs(part.geometry.boundingBox.min.z + 0.5) < 1e-6);
    assert.ok(part.geometry.boundsTree);
}
console.log('loadModel: ok');
