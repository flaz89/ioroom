// Check for meshSpherecast.js: node src/components/scene/controls/meshSpherecast.check.mjs
import assert from 'node:assert/strict';
import { Mesh, Sphere, SphereGeometry, Vector3 } from 'three';
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
console.log('meshSpherecast: ok');
