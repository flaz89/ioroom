/*
* FLOOR PLAN as data (store `plan`, saved in the environment: sync/roomSync.js, Y.Map "plan").
*
* plan: { levels: [level] } — one level for now; the model is ready for several (multi-storey projects,
*   worked on one level at a time, the others shown as a hologram later).
* level: { id, name, elevation (m), wallHeight (m), floors: [floor], walls: [wall] }
* floor: { id, points: [[x, z], ...] } — polygon (room space, meters); its id is the face id of its surface.
* wall:  { id, name?, a: [x, z], b: [x, z], thickness, height? }
*   a -> b is the wall's INNER face line (the side the room sees); the thickness grows outwards, on the
*   side of the normal (dz, -dx) / length. Walls sharing an end point are joined with a miter (the outer
*   corner is where their outer lines cross), so they meet cleanly at any angle; a free end is closed by
*   an end face. Face ids: '<wall id>:inner' | ':outer' | ':edge' (top and free ends).
* ponytail: one level, no doors / windows yet (they will be openings of a wall, subtracted from areas).
*/
export const DEFAULT_WALL_HEIGHT = 2.7;
export const DEFAULT_THICKNESS = 0.15;
const JOIN_EPSILON = 1e-4; // meters: end points closer than this are the same corner

// The test room of the first versions: 6 x 6 m, open towards +Z. Same face ids as before (materials kept).
export const DEFAULT_PLAN = {
    levels: [{
        id: 'L0',
        name: 'Ground floor',
        elevation: 0,
        wallHeight: DEFAULT_WALL_HEIGHT,
        floors: [{ id: 'floor', points: [[-3, -3], [3, -3], [3, 3], [-3, 3]] }],
        walls: [
            { id: 'wall-left', name: 'Left wall', a: [-3, 3], b: [-3, -3], thickness: DEFAULT_THICKNESS },
            { id: 'wall-back', name: 'Back wall', a: [-3, -3], b: [3, -3], thickness: DEFAULT_THICKNESS },
            { id: 'wall-right', name: 'Right wall', a: [3, -3], b: [3, 3], thickness: DEFAULT_THICKNESS }
        ]
    }]
};

// The level being worked on
export const activeLevel = (plan) => plan.levels[0];

const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const scale = (p, s) => [p[0] * s, p[1] * s];
const cross = (p, q) => p[0] * q[1] - p[1] * q[0];
const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < JOIN_EPSILON;

// Unit direction a -> b, outward normal, length
export function wallFrame(wall) {
    const d = sub(wall.b, wall.a);
    const length = Math.hypot(d[0], d[1]);
    const dir = scale(d, 1 / length);
    return { dir, normal: [dir[1], -dir[0]], length };
}

// Where the lines p + s·u and q + t·v cross (null if parallel)
function intersect(p, u, q, v) {
    const den = cross(u, v);
    if (Math.abs(den) < 1e-9) return null;
    return add(p, scale(u, cross(sub(q, p), v) / den));
}

/*
* Footprint of a wall: { a, b, aOut, bOut, aJoined, bJoined } (2D, room space). aOut / bOut: outer corners,
* mitered with the wall joined at that end (if any, among `walls`); aJoined / bJoined: whether that end is
* joined (no end face there).
*/
export function wallFootprint(wall, walls) {
    const { dir, normal } = wallFrame(wall);
    const outerPoint = add(wall.a, scale(normal, wall.thickness));
    const corner = (end) => {
        const other = walls.find((item) => item !== wall && (same(item.a, end) || same(item.b, end)));
        if (other == null) return { point: add(end, scale(normal, wall.thickness)), joined: false };
        const frame = wallFrame(other);
        const otherOuter = add(other.a, scale(frame.normal, other.thickness));
        const point = intersect(outerPoint, dir, otherOuter, frame.dir);
        return { point: point ?? add(end, scale(normal, wall.thickness)), joined: point != null };
    };
    const atA = corner(wall.a), atB = corner(wall.b);
    return { a: wall.a, b: wall.b, aOut: atA.point, bOut: atB.point, aJoined: atA.joined, bJoined: atB.joined };
}

// Area of a polygon [[x, z], ...] (m², shoelace)
export function polygonArea(points) {
    let sum = 0;
    points.forEach((p, i) => { sum += cross(p, points[(i + 1) % points.length]); });
    return Math.abs(sum) / 2;
}

// Bounds of a level: { min: [x, z], max: [x, z], center, radius } (walls included)
export function levelBounds(level) {
    const points = [...level.floors.flatMap((floor) => floor.points), ...level.walls.flatMap((wall) => {
        const f = wallFootprint(wall, level.walls);
        return [f.a, f.b, f.aOut, f.bOut];
    })];
    const min = [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))];
    const max = [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
    const center = scale(add(min, max), 0.5);
    return { min, max, center, radius: Math.hypot(max[0] - center[0], max[1] - center[1]) };
}
