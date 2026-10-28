import { Matrix4, PlaneGeometry, Triangle, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
* Geometry of the room surfaces, with WORLD-SPACE UVs ("box mapping" baked on the CPU).
*
* Every face gets UVs equal to its vertex positions in meters along the face's own axes (room space),
* so a material repeats every `tileSize` meters on any surface (texture repeat = 1 / tileSize, the same
* for all), patterns stay continuous along each axis (brick courses line up all around the room) and
* nothing is ever stretched. Same look as triplanar mapping on flat surfaces, at zero shader cost and
* on both renderers. Rooms built from plans (extruded walls) will reuse planarUVs.
*
* UV rule (u = right, v = up, seen from outside the face, never mirrored):
*   +X: u = -z, v = y    -X: u = z,  v = y
*   +Z: u = x,  v = y    -Z: u = -x, v = y
*   +Y: u = x,  v = -z   -Y: u = x,  v = z
*/
const AXES = { px: [0, 1], nx: [0, -1], py: [1, 1], ny: [1, -1], pz: [2, 1], nz: [2, -1] };

// Writes world-space UVs on an already positioned geometry whose faces all point along `face` (AXES key)
export function planarUVs(geometry, face) {
    const [axis, sign] = AXES[face];
    const position = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        if (axis === 0) uv.setXY(i, -sign * z, y);
        else if (axis === 2) uv.setXY(i, sign * x, y);
        else uv.setXY(i, x, -sign * z);
    }
    uv.needsUpdate = true;
    return geometry;
}

/*
* The 6 faces of an axis-aligned box (room space): { px, nx, py, ny, pz, nz } -> PlaneGeometry already
* placed in room space (the meshes stay at the origin), facing outwards, with world-space UVs.
* center: [x, y, z], size: [sx, sy, sz] in meters.
*/
export function boxFaces(center, size) {
    const [cx, cy, cz] = center;
    const [sx, sy, sz] = size;
    const face = (name, width, height, orient, offset) => {
        const geometry = new PlaneGeometry(width, height); // faces +Z, spans X (width) and Y (height)
        orient(geometry);
        geometry.translate(cx + offset[0], cy + offset[1], cz + offset[2]);
        return planarUVs(geometry, name);
    };
    return {
        px: face('px', sz, sy, (g) => g.rotateY(Math.PI / 2), [sx / 2, 0, 0]),
        nx: face('nx', sz, sy, (g) => g.rotateY(-Math.PI / 2), [-sx / 2, 0, 0]),
        py: face('py', sx, sz, (g) => g.rotateX(-Math.PI / 2), [0, sy / 2, 0]),
        ny: face('ny', sx, sz, (g) => g.rotateX(Math.PI / 2), [0, -sy / 2, 0]),
        pz: face('pz', sx, sy, () => {}, [0, 0, sz / 2]),
        nz: face('nz', sx, sy, (g) => g.rotateY(Math.PI), [0, 0, -sz / 2])
    };
}

// Floor of size [x, z] at y = 0, facing up
export function floorGeometry(x, z) {
    const geometry = new PlaneGeometry(x, z).rotateX(-Math.PI / 2);
    return planarUVs(geometry, 'py');
}

/*
* DRAW CALL BATCHING: merges faces that share a material into one geometry (one draw call, one shadow
* draw call), keeping track of which triangles belong to which face, so picking still knows the face.
* faces: [{ geometry, surfaceId }] (indexed geometries with the same attributes, e.g. from boxFaces).
* Returns { geometry, faceRanges: [{ start, end, surfaceId, box, normal }] }: triangle index ranges (end
* excluded), plus each face's local bounding box and normal (for spherecastFaces).
*/
export function mergeFaces(faces) {
    const faceRanges = [];
    let start = 0;
    for (const face of faces) {
        const triangles = face.geometry.index.count / 3;
        face.geometry.computeBoundingBox();
        faceRanges.push({
            start,
            end: start + triangles,
            surfaceId: face.surfaceId,
            box: face.geometry.boundingBox.clone(),
            normal: new Vector3().fromBufferAttribute(face.geometry.attributes.normal, 0)
        });
        start += triangles;
    }
    return { geometry: mergeGeometries(faces.map((face) => face.geometry)), faceRanges };
}

// Surface id of the triangle `faceIndex` (raycast hit.faceIndex) of a merged geometry; null if outside
export function surfaceIdAt(faceRanges, faceIndex) {
    return faceRanges.find((range) => faceIndex >= range.start && faceIndex < range.end)?.surfaceId ?? null;
}

/*
* Sphere pointers (XR touch + grab, @pmndrs/pointer-events) test a mesh against its whole BOUNDING BOX
* unless the mesh has a `spherecast(sphere, target)` method. A merged batch spanning several walls has a
* box as big as the room: hands would always be "touching" it and that contact beats the ray. This
* returns that method for a merged mesh: the sphere is tested against EACH FACE (as when every face was its
* own mesh) and the nearest touched face is pushed as the intersection (faceIndex = its first triangle, so
* surfaceIdAt works on it too). Called as a method: `this` = the mesh.
* The face's box is only the quick reject: then the distance is to the face's real TRIANGLES. A sloped face
* (roof pitch, oblique wall) has a box as big as the room part under it: with a low eave (attic) the hands
* were always inside it and the right hand's ray never showed.
*/
const _inverse = new Matrix4();
const _local = new Vector3();
const _point = new Vector3();
const _closest = new Vector3();
const _triangle = new Triangle();

export function spherecastFaces(faceRanges) {
    return function spherecast(sphere, target) {
        _inverse.copy(this.matrixWorld).invert();
        _local.copy(sphere.center).applyMatrix4(_inverse);
        const { index, attributes: { position } } = this.geometry;
        let best = null;
        for (const range of faceRanges) {
            range.box.clampPoint(_local, _point).applyMatrix4(this.matrixWorld); // box: a lower bound, world
            if (_point.distanceToSquared(sphere.center) > sphere.radius * sphere.radius) continue;
            let localSq = Infinity;
            for (let t = range.start; t < range.end; t++) {
                _triangle.setFromAttributeAndIndices(position, index.getX(3 * t), index.getX(3 * t + 1), index.getX(3 * t + 2));
                _triangle.closestPointToPoint(_local, _closest);
                const distanceSq = _closest.distanceToSquared(_local);
                if (distanceSq < localSq) { localSq = distanceSq; _point.copy(_closest); }
            }
            _point.applyMatrix4(this.matrixWorld); // nearest point on the face, world
            const distanceSq = _point.distanceToSquared(sphere.center);
            if (distanceSq > sphere.radius * sphere.radius || (best != null && distanceSq >= best.distanceSq)) continue;
            best = { distanceSq, point: _point.clone(), range };
        }
        if (best == null) return;
        target.push({
            distance: Math.sqrt(best.distanceSq),
            point: best.point,
            object: this,
            faceIndex: best.range.start,
            face: { a: 0, b: 0, c: 0, materialIndex: 0, normal: best.range.normal.clone() },
            normal: best.range.normal.clone()
        });
    };
}
