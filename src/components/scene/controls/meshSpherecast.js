import { Matrix4, Sphere, Triangle, Vector3 } from 'three';

/*
* Exact sphere test for XR touch / grab pointers (@pmndrs/pointer-events calls `mesh.spherecast(sphere,
* target)` when a mesh has one). Without it pmndrs measures the distance to the mesh's BOUNDING BOX: on a
* sphere or a cylinder the box corners stick out far from the surface, so a fingertip pressing a post-it
* stuck on the curved surface was already "inside the box" (distance 0) and the hand's grab pointer beat
* the touch pointer on the note. Here the distance is to the closest point of the real triangles; a
* fingertip INSIDE the solid (behind the closest face) counts as touching (distance 0), like the box did.
* Use as a method: <mesh spherecast={meshSpherecast} /> (`this` = the mesh).
* Closest point: with a BVH on the geometry (`geometry.boundsTree`, catalog furniture: models/loadModel.js)
* its closest point query, which visits the nearest boxes first and skips every box farther than the best
* point found so far; without one (primitives, a few thousand triangles at most) a loop over every triangle.
*/
const _inverse = new Matrix4();
const _local = new Sphere();
const _triangle = new Triangle();
const _bestTriangle = new Triangle();
const _closest = new Vector3();
const _best = new Vector3();
const _normal = new Vector3();
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();
const _hit = { point: new Vector3(), distance: 0, faceIndex: 0 };

// Triangle `face` (index into the geometry's triangles) of `geometry` -> `triangle`
function setTriangle(triangle, geometry, face) {
    const position = geometry.attributes.position;
    const index = geometry.index;
    const i = face * 3;
    const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
    triangle.set(_a.fromBufferAttribute(position, ia), _b.fromBufferAttribute(position, ib), _c.fromBufferAttribute(position, ic));
}

// Closest point of `geometry` to `center` -> _best and its triangle -> _bestTriangle; false for an empty geometry
function closestPoint(geometry, center) {
    if (geometry.boundsTree) {
        if (!geometry.boundsTree.closestPointToPoint(center, _hit)) return false;
        _best.copy(_hit.point);
        setTriangle(_bestTriangle, geometry, _hit.faceIndex);
        return true;
    }
    const count = (geometry.index ?? geometry.attributes.position).count / 3;
    let bestDistanceSq = Infinity;
    for (let face = 0; face < count; face++) {
        setTriangle(_triangle, geometry, face);
        _triangle.closestPointToPoint(center, _closest);
        const distanceSq = _closest.distanceToSquared(center);
        if (distanceSq >= bestDistanceSq) continue;
        bestDistanceSq = distanceSq;
        _best.copy(_closest);
        _bestTriangle.copy(_triangle);
    }
    return bestDistanceSq !== Infinity;
}

export function meshSpherecast(sphere, target) {
    const { geometry, matrixWorld } = this;
    if (geometry.boundingSphere == null) geometry.computeBoundingSphere();
    _inverse.copy(matrixWorld).invert();
    _local.copy(sphere).applyMatrix4(_inverse); // radius scaled by the largest axis: a safe bound for the early out
    if (geometry.boundingSphere.distanceToPoint(_local.center) > _local.radius) return;

    if (!closestPoint(geometry, _local.center)) return;
    _bestTriangle.getNormal(_normal);
    const inside = _normal.dot(_closest.copy(_local.center).sub(_best)) < 0; // center behind the closest face

    const point = _best.clone().applyMatrix4(matrixWorld);
    const distance = inside ? 0 : point.distanceTo(sphere.center);
    if (distance > sphere.radius) return;
    const normal = _normal.clone().transformDirection(matrixWorld);
    target.push({ distance, point, object: this, face: { a: 0, b: 0, c: 0, materialIndex: 0, normal }, normal });
}
