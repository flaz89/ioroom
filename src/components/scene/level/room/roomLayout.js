import { BufferGeometry, Float32BufferAttribute, Shape, ShapeGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { planarUVs } from './roomGeometry.js';
import { faceOffsets, openingFloors, openingRects, polygonArea, wallFootprint, wallFrame } from '../../../../plan/planModel.js';

/*
* The faces of a plan level (plan/planModel.js) as geometry: what Room.jsx draws and what the bill of
* quantities measures (surfaceAreas), so both always agree.
*
* - Floors: polygons, world-space UVs in meters (planarUVs, same rule as before), plus the strips under the
*   floor-level openings they run through (planModel.openingFloors: the chosen room's floor fills the
*   opening's depth, no threshold; same UVs, so the pattern continues).
* - Walls: prisms on their mitered footprint (wallFootprint), height = wall.height ?? level.wallHeight.
*   Faces: inner, outer, top and the free ends ("edge"); the bottom sits on the floor (not built) and the
*   ends at a joint are inside the neighbour (not built). UVs in meters, anchored to the world along the
*   wall direction, so a pattern continues across collinear walls; never mirrored seen from outside.
*   Openings (doors / windows, planModel.openingRects) are cut through the inner and outer faces; their
*   reveals (jambs, head, sill; a threshold only when no floor fills the opening) belong to the wall's
*   "edge" face.
* Face ids: floor.id, '<wall>:inner' | ':outer' | ':edge'. Every geometry is indexed with position, normal
* and uv, so batches can be merged (roomGeometry.js mergeFaces).
*/
const FLOOR_COLOR = '#d4d4d4'; // plain material colors
const WALL_COLOR = '#ffffff';

const wallHeight = (wall, level) => wall.height ?? level.wallHeight;

// One quad (two triangles) with the given corners (3D, any order around the quad), normal and UVs
function quad(points, normal, uvs) {
    const [p0, p1, p2] = points.map((p) => new Vector3(...p));
    const facing = p1.clone().sub(p0).cross(p2.clone().sub(p0)).dot(new Vector3(...normal));
    const order = facing >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3));
    geometry.setAttribute('normal', new Float32BufferAttribute([normal, normal, normal, normal].flat(), 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs.flat(), 2));
    geometry.setIndex(order);
    return geometry;
}

// A floor polygon at height y, facing up (or down for a ceiling), world-space UVs
export function polygonGeometry(points, y = 0, facingDown = false) {
    const shape = new Shape(points.map(([x, z]) => ({ x, y: facingDown ? z : -z })));
    const geometry = new ShapeGeometry(shape).rotateX(facingDown ? Math.PI / 2 : -Math.PI / 2).translate(0, y, 0);
    return planarUVs(geometry, facingDown ? 'ny' : 'py');
}

/*
* One face of a wall with the openings cut out, as columns of quads between the openings' sides (no
* triangulation, exact UVs). t0 / t1: the face's extent along the drawn line (from `a`); h: wall height;
* point(t, y) / uv(t, y): 3D point and UV of the face at (t, y). Openings never overlap (addOpening).
*/
function holedFace(t0, t1, h, rects, point, normal, uv) {
    const cuts = [...new Set([t0, t1, ...rects.flatMap((r) => [r.from, r.to]).filter((t) => t > t0 && t < t1)])].sort((p, q) => p - q);
    const quads = [];
    for (let i = 1; i < cuts.length; i++) {
        const ta = cuts[i - 1], tb = cuts[i];
        if (tb - ta < 1e-6) continue;
        const hole = rects.find((r) => r.from < (ta + tb) / 2 && r.to > (ta + tb) / 2);
        const spans = hole ? [[0, hole.bottom], [hole.top, h]] : [[0, h]]; // solid parts of this column
        for (const [y0, y1] of spans) {
            if (y1 - y0 < 1e-6) continue;
            const corners = [[ta, y0], [tb, y0], [tb, y1], [ta, y1]];
            quads.push(quad(corners.map(([t, y]) => point(t, y)), normal, corners.map(([t, y]) => uv(t, y))));
        }
    }
    return quads.length === 1 ? quads[0] : mergeGeometries(quads);
}

// The faces of one wall: [{ part: 'inner' | 'outer' | 'edge', geometry, vertical }]
// filled: ids of this wall's openings whose depth a floor fills (openingFloors): no threshold built there
function wallGeometries(wall, level, filled) {
    const h = wallHeight(wall, level);
    const { dir, normal } = wallFrame(wall);
    const { a, b, aOut, bOut, aJoined, bJoined } = wallFootprint(wall, level.walls);
    const offsets = faceOffsets(wall);
    const rects = openingRects(wall, h);
    const at = (p, y) => [p[0], y, p[1]];
    const along = (p) => p[0] * dir[0] + p[1] * dir[1];     // world-anchored coordinate along the wall
    const across = (p) => p[0] * normal[0] + p[1] * normal[1];
    const lineT = (p) => (p[0] - wall.a[0]) * dir[0] + (p[1] - wall.a[1]) * dir[1]; // distance from `a` along the line
    // 3D point at distance t along the line, `offset` from it along the normal (a face), height y
    const onLine = (t, offset, y) => [wall.a[0] + dir[0] * t + normal[0] * offset, y, wall.a[1] + dir[1] * t + normal[1] * offset];
    const along0 = along(wall.a), across0 = across(wall.a);
    const inward = [-normal[0], 0, -normal[1]];
    const faces = [
        { part: 'inner', vertical: true, geometry: holedFace(lineT(a), lineT(b), h, rects,
            (t, y) => onLine(t, offsets.inner, y), inward, (t, y) => [along0 + t, y]) },
        { part: 'outer', vertical: true, geometry: holedFace(lineT(aOut), lineT(bOut), h, rects,
            (t, y) => onLine(t, offsets.outer, y), [normal[0], 0, normal[1]], (t, y) => [-(along0 + t), y]) },
        { part: 'edge', vertical: false, geometry: quad([at(a, h), at(b, h), at(bOut, h), at(aOut, h)], [0, 1, 0],
            [a, b, bOut, aOut].map((p) => [along(p), across(p)])) }
    ];
    if (!aJoined) faces.push({ part: 'edge', vertical: true, geometry: quad([at(a, 0), at(aOut, 0), at(aOut, h), at(a, h)], [-dir[0], 0, -dir[1]],
        [[across(a), 0], [across(aOut), 0], [across(aOut), h], [across(a), h]]) });
    if (!bJoined) faces.push({ part: 'edge', vertical: true, geometry: quad([at(b, 0), at(bOut, 0), at(bOut, h), at(b, h)], [dir[0], 0, dir[1]],
        [[-across(b), 0], [-across(bOut), 0], [-across(bOut), h], [-across(b), h]]) });
    // Reveals of each opening, through the wall's thickness: jambs facing into the opening, head facing
    // down, sill (window) / threshold (door) facing up
    const { inner: fi, outer: fo } = offsets;
    for (const { opening, from, to, bottom, top } of rects) {
        const jamb = (t, sign) => quad([onLine(t, fi, bottom), onLine(t, fo, bottom), onLine(t, fo, top), onLine(t, fi, top)],
            [dir[0] * sign, 0, dir[1] * sign], [[across0 + fi, bottom], [across0 + fo, bottom], [across0 + fo, top], [across0 + fi, top]]);
        const flat = (y, up) => quad([onLine(from, fi, y), onLine(to, fi, y), onLine(to, fo, y), onLine(from, fo, y)],
            [0, up, 0], [[along0 + from, across0 + fi], [along0 + to, across0 + fi], [along0 + to, across0 + fo], [along0 + from, across0 + fo]]);
        faces.push(
            { part: 'edge', vertical: true, geometry: jamb(from, 1) },
            { part: 'edge', vertical: true, geometry: jamb(to, -1) },
            { part: 'edge', vertical: false, geometry: flat(top, -1) }
        );
        if (!filled.has(opening.id)) faces.push({ part: 'edge', vertical: false, geometry: flat(bottom, 1) });
    }
    return faces;
}

/*
* Every visible face of a level: { key, geometry, surfaceId, vertical, color }.
*/
export function roomFaces(level) {
    const patches = openingFloors(level);
    const filled = new Set(patches.map((patch) => patch.openingId));
    return [
        ...level.floors.map((floor) => {
            const strips = patches.filter((patch) => patch.floorId === floor.id).map((patch) => polygonGeometry(patch.points));
            const geometry = strips.length > 0 ? mergeGeometries([polygonGeometry(floor.points), ...strips]) : polygonGeometry(floor.points);
            return { key: floor.id, geometry, surfaceId: floor.id, vertical: false, color: FLOOR_COLOR };
        }),
        ...level.walls.flatMap((wall) => wallGeometries(wall, level, filled).map((face, index) => ({
            key: `${wall.id}-${face.part}-${index}`,
            geometry: face.geometry,
            surfaceId: `${wall.id}:${face.part}`,
            vertical: face.vertical,
            color: WALL_COLOR
        })))
    ];
}

/*
* Area of every face id of a level: { surfaceId: m² }, from the plan data (no geometry): floor polygons;
* inner face = inner line x height (exactly the side the room sees); outer = outer line x height; edge =
* top (footprint) + free ends + opening reveals (no threshold where a floor fills the opening: that strip
* counts for the floor). Openings are subtracted from the inner / outer faces
* (the part of each opening within that face). Rounded to cm².
*/
export function surfaceAreas(level) {
    const areas = {};
    const put = (id, value) => { areas[id] = Math.round(((areas[id] ?? 0) + value) * 100) / 100; };
    for (const floor of level.floors) put(floor.id, polygonArea(floor.points));
    const patches = openingFloors(level);
    for (const patch of patches) put(patch.floorId, polygonArea(patch.points));
    const filled = new Set(patches.map((patch) => patch.openingId));
    for (const wall of level.walls) {
        const h = wallHeight(wall, level);
        const f = wallFootprint(wall, level.walls);
        const length = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
        const { dir } = wallFrame(wall);
        const lineT = (p) => (p[0] - wall.a[0]) * dir[0] + (p[1] - wall.a[1]) * dir[1];
        const rects = openingRects(wall, h);
        // area of the openings within a face spanning t0..t1 along the line
        const holes = (t0, t1) => rects.reduce((sum, r) => sum + Math.max(0, Math.min(r.to, t1) - Math.max(r.from, t0)) * (r.top - r.bottom), 0);
        // jambs + head, and the threshold unless a floor fills the opening
        const reveals = rects.reduce((sum, r) => sum + (2 * (r.top - r.bottom) + (filled.has(r.opening.id) ? 1 : 2) * (r.to - r.from)) * wall.thickness, 0);
        put(`${wall.id}:inner`, length(f.a, f.b) * h - holes(lineT(f.a), lineT(f.b)));
        put(`${wall.id}:outer`, length(f.aOut, f.bOut) * h - holes(lineT(f.aOut), lineT(f.bOut)));
        put(`${wall.id}:edge`, polygonArea([f.a, f.b, f.bOut, f.aOut])
            + (f.aJoined ? 0 : length(f.a, f.aOut) * h) + (f.bJoined ? 0 : length(f.b, f.bOut) * h) + reveals);
    }
    return areas;
}

// Human name of a face id, e.g. 'wall-left:inner' -> 'Left wall · inside' (walls without a name: "Wall 3")
export function surfaceLabel(surfaceId, level) {
    const floorIndex = level.floors.findIndex((floor) => floor.id === surfaceId);
    if (floorIndex >= 0) return level.floors.length > 1 ? `Floor ${floorIndex + 1}` : 'Floor';
    const [wallId, side] = surfaceId.split(':');
    const index = level.walls.findIndex((wall) => wall.id === wallId);
    const name = level.walls[index]?.name ?? (index >= 0 ? `Wall ${index + 1}` : 'Removed wall');
    const sides = { inner: 'inside', outer: 'outside', edge: 'top & ends' };
    return `${name} · ${sides[side] ?? side}`;
}
