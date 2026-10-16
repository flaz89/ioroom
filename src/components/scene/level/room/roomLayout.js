import { BufferGeometry, Float32BufferAttribute, Shape, ShapeGeometry, Vector3 } from 'three';
import { planarUVs } from './roomGeometry.js';
import { polygonArea, wallFootprint, wallFrame } from '../../../../plan/planModel.js';

/*
* The faces of a plan level (plan/planModel.js) as geometry: what Room.jsx draws and what the bill of
* quantities measures (surfaceAreas), so both always agree.
*
* - Floors: polygons, world-space UVs in meters (planarUVs, same rule as before).
* - Walls: prisms on their mitered footprint (wallFootprint), height = wall.height ?? level.wallHeight.
*   Faces: inner, outer, top and the free ends ("edge"); the bottom sits on the floor (not built) and the
*   ends at a joint are inside the neighbour (not built). UVs in meters, anchored to the world along the
*   wall direction, so a pattern continues across collinear walls; never mirrored seen from outside.
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

// The faces of one wall: [{ part: 'inner' | 'outer' | 'edge', geometry, vertical }]
function wallGeometries(wall, level) {
    const h = wallHeight(wall, level);
    const { dir, normal } = wallFrame(wall);
    const { a, b, aOut, bOut, aJoined, bJoined } = wallFootprint(wall, level.walls);
    const at = (p, y) => [p[0], y, p[1]];
    const along = (p) => p[0] * dir[0] + p[1] * dir[1];     // world-anchored coordinate along the wall
    const across = (p) => p[0] * normal[0] + p[1] * normal[1];
    const inward = [-normal[0], 0, -normal[1]];
    const faces = [
        { part: 'inner', vertical: true, geometry: quad([at(a, 0), at(b, 0), at(b, h), at(a, h)], inward,
            [[along(a), 0], [along(b), 0], [along(b), h], [along(a), h]]) },
        { part: 'outer', vertical: true, geometry: quad([at(aOut, 0), at(bOut, 0), at(bOut, h), at(aOut, h)], [normal[0], 0, normal[1]],
            [[-along(aOut), 0], [-along(bOut), 0], [-along(bOut), h], [-along(aOut), h]]) },
        { part: 'edge', vertical: false, geometry: quad([at(a, h), at(b, h), at(bOut, h), at(aOut, h)], [0, 1, 0],
            [a, b, bOut, aOut].map((p) => [along(p), across(p)])) }
    ];
    if (!aJoined) faces.push({ part: 'edge', vertical: true, geometry: quad([at(a, 0), at(aOut, 0), at(aOut, h), at(a, h)], [-dir[0], 0, -dir[1]],
        [[across(a), 0], [across(aOut), 0], [across(aOut), h], [across(a), h]]) });
    if (!bJoined) faces.push({ part: 'edge', vertical: true, geometry: quad([at(b, 0), at(bOut, 0), at(bOut, h), at(b, h)], [dir[0], 0, dir[1]],
        [[-across(b), 0], [-across(bOut), 0], [-across(bOut), h], [-across(b), h]]) });
    return faces;
}

/*
* Every visible face of a level: { key, geometry, surfaceId, vertical, color }.
*/
export function roomFaces(level) {
    return [
        ...level.floors.map((floor) => ({
            key: floor.id, geometry: polygonGeometry(floor.points), surfaceId: floor.id, vertical: false, color: FLOOR_COLOR
        })),
        ...level.walls.flatMap((wall) => wallGeometries(wall, level).map((face, index) => ({
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
* top (footprint) + free ends. Rounded to cm².
*/
export function surfaceAreas(level) {
    const areas = {};
    const put = (id, value) => { areas[id] = Math.round(((areas[id] ?? 0) + value) * 100) / 100; };
    for (const floor of level.floors) put(floor.id, polygonArea(floor.points));
    for (const wall of level.walls) {
        const h = wallHeight(wall, level);
        const f = wallFootprint(wall, level.walls);
        const length = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
        put(`${wall.id}:inner`, length(f.a, f.b) * h);
        put(`${wall.id}:outer`, length(f.aOut, f.bOut) * h);
        put(`${wall.id}:edge`, polygonArea([f.a, f.b, f.bOut, f.aOut])
            + (f.aJoined ? 0 : length(f.a, f.aOut) * h) + (f.bJoined ? 0 : length(f.b, f.bOut) * h));
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
