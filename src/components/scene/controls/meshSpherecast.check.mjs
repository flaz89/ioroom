// Check for meshSpherecast.js: node src/components/scene/controls/meshSpherecast.check.mjs
import assert from 'node:assert/strict';
import { CylinderGeometry, Mesh, Sphere, SphereGeometry, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { meshSpherecast } from './meshSpherecast.js';

const ball = new Mesh(new SphereGeometry(0.5, 32, 16));
ball.updateMatrixWorld();
const cast = (x, y, z, r = 0.05) => { const hits = []; meshSpherecast.call(ball, new Sphere(new Vector3(x, y, z), r), hits); return hits; };
// near a box CORNER of the ball (inside its bounding box, far from the surface): no contact
assert.equal(cast(0.45, 0.45, 0).length, 0);
// just outside the surface: contact, at the right distance
const near = cast(0.52, 0, 0);
assert.equal(near.length, 1);
assert.ok(Math.abs(near[0].distance - 0.02) < 0.005, `distance ${near[0].distance}`);
// inside the solid: touching (distance 0)
assert.equal(cast(0.1, 0, 0)[0].distance, 0);
// far away: nothing
assert.equal(cast(2, 0, 0).length, 0);

// With a BVH (catalog furniture, models/loadModel.js): same answers as the loop, on a sphere and a cylinder
// (moved and rotated), for random fingertips inside, near and around the surface
for (const geometry of [new SphereGeometry(0.5, 32, 16), new CylinderGeometry(0.3, 0.3, 1, 24)]) {
    const plain = new Mesh(geometry);
    const fast = new Mesh(geometry.clone());
    fast.geometry.boundsTree = new MeshBVH(fast.geometry, { indirect: true });
    for (const mesh of [plain, fast]) { mesh.position.set(1, 2, -1); mesh.rotation.set(0.3, 0.7, 0); mesh.updateMatrixWorld(); }
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5; // deterministic
    let contacts = 0;
    for (let i = 0; i < 500; i++) {
        const sphere = new Sphere(new Vector3(1 + random() * 1.6, 2 + random() * 1.6, -1 + random() * 1.6), 0.03 + (random() + 0.5) * 0.1);
        const a = [], b = [];
        meshSpherecast.call(plain, sphere, a);
        meshSpherecast.call(fast, sphere, b);
        assert.equal(a.length, b.length, `hit count at sample ${i}`);
        if (a.length === 0) continue;
        contacts++;
        assert.ok(Math.abs(a[0].distance - b[0].distance) < 1e-9, `distance at sample ${i}`);
        assert.ok(a[0].point.distanceTo(b[0].point) < 1e-9, `point at sample ${i}`);
    }
    assert.ok(contacts > 50, `too few contacts tested (${contacts})`);
}
// inside the solid with a BVH: touching (distance 0)
const tree = new Mesh(new SphereGeometry(0.5, 32, 16));
tree.geometry.boundsTree = new MeshBVH(tree.geometry, { indirect: true });
tree.updateMatrixWorld();
const insideHits = []; meshSpherecast.call(tree, new Sphere(new Vector3(0.1, 0, 0), 0.05), insideHits);
assert.equal(insideHits[0].distance, 0);
console.log('meshSpherecast: ok');
