import { Matrix4, Sphere, Triangle, Vector3 } from 'three';

/*
* Exact sphere test for XR touch / grab pointers (@pmndrs/pointer-events calls `mesh.spherecast(sphere,
* target)` when a mesh has one). Without it pmndrs measures the distance to the mesh's BOUNDING BOX: on a
* sphere or a cylinder the box corners stick out far from the surface, so a fingertip pressing a post-it
* stuck on the curved surface was already "inside the box" (distance 0) and the hand's grab pointer beat
* the touch pointer on the note. Here the distance is to the closest point of the real triangles; a
* fingertip INSIDE the solid (behind the closest face) counts as touching (distance 0), like the box did.
* Use as a method: <mesh spherecast={meshSpherecast} /> (`this` = the mesh).
* ponytail: loops over every triangle (fine for the primitives, up to a few thousand triangles); GLB
* furniture will need a BVH (three-mesh-bvh) here.
*/
const _inverse = new Matrix4();
const _local = new Sphere();
const _triangle = new Triangle();
const _closest = new Vector3();
const _best = new Vector3();
const _normal = new Vector3();
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();

export function meshSpherecast(sphere, target) {
    const { geometry, matrixWorld } = this;
    if (geometry.boundingSphere == null) geometry.computeBoundingSphere();
    _inverse.copy(matrixWorld).invert();
    _local.copy(sphere).applyMatrix4(_inverse); // radius scaled by the largest axis: a safe bound for the early out
    if (geometry.boundingSphere.distanceToPoint(_local.center) > _local.radius) return;

    const position = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    let bestDistanceSq = Infinity;
    let inside = false;
    for (let i = 0; i < count; i += 3) {
        const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
        _triangle.set(_a.fromBufferAttribute(position, ia), _b.fromBufferAttribute(position, ib), _c.fromBufferAttribute(position, ic));
        _triangle.closestPointToPoint(_local.center, _closest);
        const distanceSq = _closest.distanceToSquared(_local.center);
        if (distanceSq >= bestDistanceSq) continue;
        bestDistanceSq = distanceSq;
        _best.copy(_closest);
        _triangle.getNormal(_normal);
        inside = _normal.dot(_closest.sub(_local.center).negate()) < 0; // center behind the closest face
    }
    if (bestDistanceSq === Infinity) return;

    const point = _best.clone().applyMatrix4(matrixWorld);
    const distance = inside ? 0 : point.distanceTo(sphere.center);
    if (distance > sphere.radius) return;
    const normal = _normal.clone().transformDirection(matrixWorld);
    target.push({ distance, point, object: this, face: { a: 0, b: 0, c: 0, materialIndex: 0, normal }, normal });
}
