import { EdgesGeometry, Line3, Vector3 } from 'three';

/*
* Ruler snapping: the point under the pointer on a mesh, moved onto a nearby CORNER (feature-edge end
* point) or, failing that, onto a nearby EDGE, within `threshold` (world meters).
* Feature edges = EdgesGeometry with a crease angle: the outline of a box, the rims of a cylinder, the
* corners of the room; not the diagonals of flat quads nor the facets of a smooth sphere. Computed once per
* geometry (WeakMap cache: a rebuilt geometry, e.g. a new room batch, gets its own entry).
* Returns { point (new Vector3, world), kind: 'vertex' | 'edge' | 'surface' }.
*/
const CREASE_DEGREES = 20;
const edgeCache = new WeakMap(); // geometry -> Float32Array [ax, ay, az, bx, by, bz, ...] (local space)

function featureEdges(geometry) {
    let edges = edgeCache.get(geometry);
    if (edges == null) {
        const edgesGeometry = new EdgesGeometry(geometry, CREASE_DEGREES);
        edges = edgesGeometry.attributes.position.array.slice();
        edgesGeometry.dispose();
        edgeCache.set(geometry, edges);
    }
    return edges;
}

const _a = new Vector3(), _b = new Vector3(), _closest = new Vector3();
const _line = new Line3();

export function snapPoint(mesh, point, threshold) {
    const edges = featureEdges(mesh.geometry);
    const matrix = mesh.matrixWorld;
    let vertex = null, vertexDistance = threshold;
    let edge = null, edgeDistance = threshold;
    for (let i = 0; i < edges.length; i += 6) {
        _a.set(edges[i], edges[i + 1], edges[i + 2]).applyMatrix4(matrix);
        _b.set(edges[i + 3], edges[i + 4], edges[i + 5]).applyMatrix4(matrix);
        for (const end of [_a, _b]) {
            const distance = end.distanceTo(point);
            if (distance < vertexDistance) { vertexDistance = distance; vertex = end.clone(); }
        }
        _line.set(_a, _b).closestPointToPoint(point, true, _closest);
        const distance = _closest.distanceTo(point);
        if (distance < edgeDistance) { edgeDistance = distance; edge = _closest.clone(); }
    }
    if (vertex) return { point: vertex, kind: 'vertex' };
    if (edge) return { point: edge, kind: 'edge' };
    return { point: point.clone(), kind: 'surface' };
}

// "2,40 m" / "85 cm" (Italian decimal comma; below 1 m in centimeters)
export function formatLength(meters) {
    if (meters < 1) return `${Math.round(meters * 100)} cm`;
    return `${meters.toFixed(2).replace('.', ',')} m`;
}

/*
* AXIS LOCK (default while taking a measure; Shift = free): the second point slides along one of the
* three axes through the first point `start` (board space: the room's axes, also on a rotated tabletop).
* - The axis is the one whose line passes closest to the pointer ray, measured as an angle from the
*   viewer (distance between ray and axis line / distance along the ray): what "looks" closest on screen.
* - Where along it, first match wins:
*   1. a snapped corner / edge under the pointer (`snapped`): its projection on the axis (e.g. the exact
*      height of a wall top corner);
*   2. the SURFACE under the pointer (`plane`: { point, normal }): where the axis meets its plane, when
*      the axis is not nearly parallel to it (e.g. pointing anywhere on the opposite wall measures right
*      up to that wall);
*   3. the point of the axis line closest to the pointer ray.
* All vectors in board space; rayDirection normalized. Returns { point: Vector3, axis: 'x' | 'y' | 'z' }.
*/
export const AXES = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
const _w = new Vector3(), _onRay = new Vector3();

// Closest approach between the ray (origin o, unit dir d) and the line (point s, unit dir a)
function rayToLine(o, d, s, a) {
    _w.subVectors(o, s);
    const b = d.dot(a), dw = d.dot(_w), aw = a.dot(_w);
    const den = 1 - b * b;
    if (den < 1e-8) return null; // looking along the axis
    const tRay = Math.max((b * aw - dw) / den, 1e-6);
    const tLine = aw + b * tRay; // line point closest to the ray point at tRay
    _onRay.copy(d).multiplyScalar(tRay).add(o);
    const onLine = a.clone().multiplyScalar(tLine).add(s);
    return { tLine, angle: _onRay.distanceTo(onLine) / tRay };
}

const MIN_PLANE_ANGLE = 0.25; // |cos| between axis and plane normal: below it the axis grazes the plane

export function lockToAxis(start, rayOrigin, rayDirection, snapped = null, plane = null) {
    let best = null;
    for (const [axis, direction] of Object.entries(AXES)) {
        const hit = rayToLine(rayOrigin, rayDirection, start, direction);
        if (hit != null && (best == null || hit.angle < best.angle)) best = { axis, direction, ...hit };
    }
    if (best == null) return { point: start.clone(), axis: 'y' };
    let t = best.tLine;
    if (snapped != null) {
        t = _w.subVectors(snapped, start).dot(best.direction);
    } else if (plane != null) {
        const facing = best.direction.dot(plane.normal);
        if (Math.abs(facing) > MIN_PLANE_ANGLE) t = _w.subVectors(plane.point, start).dot(plane.normal) / facing;
    }
    return { point: best.direction.clone().multiplyScalar(t).add(start), axis: best.axis };
}

/*
* Snap to the EXISTING MEASURES: their end points first, then any point of their lines. Measures often
* float in the air (no surface under them), so this works on the pointer RAY: a candidate counts when the
* ray passes within `maxAngle` of it as seen from the ray origin (perpendicular distance / distance along
* the ray: the same screen-space feel as the surface snap).
* segments: [{ a: Vector3, b: Vector3 }] (same space as the ray). Returns { point: Vector3, kind:
* 'vertex' | 'edge', index (segment), endpoint: 'a' | 'b' | null } or null.
*/
const _onSegment = new Vector3(), _onRayPoint = new Vector3();

export function snapToSegments(ray, segments, maxAngle) {
    let vertex = null, edge = null;
    segments.forEach(({ a, b }, index) => {
        for (const [name, end] of [['a', a], ['b', b]]) {
            const along = _onRayPoint.subVectors(end, ray.origin).dot(ray.direction);
            if (along <= 0) continue;
            const angle = ray.distanceToPoint(end) / along;
            if (angle < maxAngle && (vertex == null || angle < vertex.angle)) vertex = { point: end.clone(), kind: 'vertex', index, endpoint: name, angle };
        }
        const distance = Math.sqrt(ray.distanceSqToSegment(a, b, _onRayPoint, _onSegment));
        const along = _onRayPoint.distanceTo(ray.origin);
        if (along <= 0) return;
        const angle = distance / along;
        if (angle < maxAngle && (edge == null || angle < edge.angle)) edge = { point: _onSegment.clone(), kind: 'edge', index, endpoint: null, angle };
    });
    const best = vertex ?? edge;
    if (best == null) return null;
    delete best.angle;
    return best;
}
