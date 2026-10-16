// Check for measureSnap.js: node src/components/scene/measure/measureSnap.check.mjs
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, Vector3 } from 'three';
import { formatLength, snapPoint } from './measureSnap.js';

const box = new Mesh(new BoxGeometry(1, 1, 1)); // corners at ±0.5
box.position.set(2, 0, 0);
box.updateMatrixWorld();
// near a corner -> the corner
let snap = snapPoint(box, new Vector3(2.48, 0.49, 0.5), 0.05);
assert.equal(snap.kind, 'vertex');
assert.ok(snap.point.distanceTo(new Vector3(2.5, 0.5, 0.5)) < 1e-6);
// near the middle of an edge -> onto the edge (not the face diagonal)
snap = snapPoint(box, new Vector3(2.0, 0.48, 0.5), 0.05);
assert.equal(snap.kind, 'edge');
assert.ok(snap.point.distanceTo(new Vector3(2.0, 0.5, 0.5)) < 1e-6);
// middle of a face: on the diagonal of its two triangles, but no snap (not a feature edge)
snap = snapPoint(box, new Vector3(2.1, 0.1, 0.5), 0.05);
assert.equal(snap.kind, 'surface');
assert.equal(formatLength(2.4), '2,40 m');
assert.equal(formatLength(0.853), '85 cm');
console.log('measureSnap: ok');

// Axis lock
{
    const { lockToAxis } = await import('./measureSnap.js');
    const start = new Vector3(0, 0, 0);
    // camera in front, pointer ray towards a point straight above the start: vertical axis
    const eye = new Vector3(0, 1.5, 5);
    const toward = (target) => target.clone().sub(eye).normalize();
    let lock = lockToAxis(start, eye, toward(new Vector3(0.05, 2.7, 0)));
    assert.equal(lock.axis, 'y');
    assert.ok(Math.abs(lock.point.x) < 1e-9 && Math.abs(lock.point.z) < 1e-9, 'stays on the axis');
    // pointer towards a point to the right at floor level: X axis
    lock = lockToAxis(start, eye, toward(new Vector3(3, 0.1, 0)));
    assert.equal(lock.axis, 'x');
    // a snapped corner gives the exact length along the chosen axis (2.7 m wall top)
    lock = lockToAxis(start, eye, toward(new Vector3(0.05, 2.6, 0)), new Vector3(0.1, 2.7, -0.08));
    assert.equal(lock.axis, 'y');
    assert.ok(Math.abs(lock.point.y - 2.7) < 1e-9 && lock.point.x === 0);
    // pointing anywhere on a wall (plane x = 3) along X: the measure ends on the wall
    lock = lockToAxis(start, eye, toward(new Vector3(3, 0.4, 0.3)), null, { point: new Vector3(3, 0.4, 0.3), normal: new Vector3(-1, 0, 0) });
    assert.equal(lock.axis, 'x');
    assert.ok(Math.abs(lock.point.x - 3) < 1e-9 && lock.point.y === 0 && lock.point.z === 0, `${lock.point.toArray()}`);
    console.log('measureSnap axis lock: ok');
}

// Snap to existing measures (ray based)
{
    const { snapToSegments } = await import('./measureSnap.js');
    const { Ray } = await import('three');
    const segments = [{ a: new Vector3(0, 1, 0), b: new Vector3(2, 1, 0) }];
    const eye = new Vector3(1, 1, 5);
    const ray = (x, y, z) => new Ray(eye.clone(), new Vector3(x, y, z).sub(eye).normalize());
    let snap = snapToSegments(ray(2.02, 1.01, 0), segments, 0.02); // near the end b
    assert.equal(snap.kind, 'vertex'); assert.equal(snap.endpoint, 'b');
    snap = snapToSegments(ray(1.3, 1.02, 0), segments, 0.02);      // near the middle of the line
    assert.equal(snap.kind, 'edge');
    assert.ok(Math.abs(snap.point.y - 1) < 1e-9 && Math.abs(snap.point.x - 1.3) < 0.01, `${snap.point.toArray()}`);
    assert.equal(snapToSegments(ray(1, 1.5, 0), segments, 0.02), null); // far from it
    console.log('measureSnap measures: ok');
}
