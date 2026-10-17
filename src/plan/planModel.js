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
export const MIN_WALL_LENGTH = 0.05; // meters: editing never makes a wall shorter than this

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

// The plan with the level being worked on replaced by `level` (the other levels untouched)
export const withActiveLevel = (plan, level) => ({ ...plan, levels: [level, ...plan.levels.slice(1)] });

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

// Distinct wall end points of a level ([x, z]); joined ends count once (corners of the plan editor)
export function levelVertices(level) {
    const vertices = [];
    for (const wall of level.walls) {
        for (const end of [wall.a, wall.b]) if (!vertices.some((v) => same(v, end))) vertices.push(end);
    }
    return vertices;
}

/*
* Moves the corner at `from` to `to`: every wall end AND floor point on that corner moves with it, so joined
* walls stay joined and the floor follows. Returns the new level, or null when a wall would become shorter
* than MIN_WALL_LENGTH (the editor keeps the last valid position).
*/
export function moveVertex(level, from, to) {
    const move = (point) => (same(point, from) ? [to[0], to[1]] : point);
    const walls = level.walls.map((wall) => (same(wall.a, from) || same(wall.b, from)
        ? { ...wall, a: move(wall.a), b: move(wall.b) }
        : wall));
    const isValid = walls.every((wall) => Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) >= MIN_WALL_LENGTH);
    if (!isValid) return null;
    const floors = level.floors.map((floor) => (floor.points.some((p) => same(p, from))
        ? { ...floor, points: floor.points.map(move) }
        : floor));
    return { ...level, walls, floors };
}

// Editable ranges of a wall (meters), shared by the plan editor's fields
export const WALL_LIMITS = {
    thickness: { min: 0.05, max: 1 },
    height: { min: 0.1, max: 10 }
};

// The level with wall `wallId` merged with `patch` (e.g. { thickness: 0.3 })
export function updateWall(level, wallId, patch) {
    return { ...level, walls: level.walls.map((wall) => (wall.id === wallId ? { ...wall, ...patch } : wall)) };
}

/*
* Sets the length of wall `wallId` keeping its start `a` fixed: the end `b` slides along the wall's
* direction, and walls joined at `b` follow (moveVertex). Returns null if a wall would become too short.
*/
export function setWallLength(level, wallId, length) {
    const wall = level.walls.find((item) => item.id === wallId);
    if (wall == null || !(length >= MIN_WALL_LENGTH)) return null;
    const { dir } = wallFrame(wall);
    return moveVertex(level, wall.b, [wall.a[0] + dir[0] * length, wall.a[1] + dir[1] * length]);
}

// New unique wall id (several devices can draw at the same time: time + random, never a counter)
export const newWallId = () => `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/*
* The level with a new wall from `a` to `b` (default thickness, level height). a -> b is the INNER line:
* the thickness grows on the left of the drawing direction as seen on the plan (screen y = world z), so a
* room drawn CLOCKWISE on screen gets its walls outside. Ends equal to existing corners join them.
* Returns null for a wall shorter than MIN_WALL_LENGTH.
*/
export function addWall(level, a, b, id = newWallId()) {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_WALL_LENGTH) return null;
    return { ...level, walls: [...level.walls, { id, a: [a[0], a[1]], b: [b[0], b[1]], thickness: DEFAULT_THICKNESS }] };
}

// Closest corner of the level to `point` within `maxDistance` meters, or null
export function nearestVertex(level, point, maxDistance) {
    let best = null, bestDistance = maxDistance;
    for (const vertex of levelVertices(level)) {
        const distance = Math.hypot(vertex[0] - point[0], vertex[1] - point[1]);
        if (distance <= bestDistance) { best = vertex; bestDistance = distance; }
    }
    return best;
}

/*
* Moves the thickness of wall `wallId` to the other side of its line: a and b are swapped, so the line the
* user drew stays where it is and the outward normal flips. The faces swap roles too: what was ':inner'
* is now ':outer' (the caller swaps the surface materials, planSlice.flipWallSide).
*/
export function flipWall(level, wallId) {
    return { ...level, walls: level.walls.map((wall) => (wall.id === wallId ? { ...wall, a: wall.b, b: wall.a } : wall)) };
}
