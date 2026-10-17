/*
* FLOOR PLAN as data (store `plan`, saved in the environment: sync/roomSync.js, Y.Map "plan").
*
* plan: { levels: [level] } — one level for now; the model is ready for several (multi-storey projects,
*   worked on one level at a time, the others shown as a hologram later).
* level: { id, name, elevation (m), wallHeight (m), floors: [floor], walls: [wall] }
* floor: { id, points: [[x, z], ...] } — polygon (room space, meters); its id is the face id of its surface.
* wall:  { id, name?, a: [x, z], b: [x, z], thickness, height?, align? }
*   a -> b is the wall's drawn line. align undefined: the line is the INNER face (the side the room sees)
*   and the thickness grows on the side of the normal (dz, -dx) / length; align 'center': the line is the
*   wall's axis (half thickness each side). Walls sharing an end point are mitered face by face
*   (wallFootprint), so they meet cleanly at any angle; a free end is closed by an end face.
*   Face ids: '<wall id>:inner' | ':outer' | ':edge' (top and free ends).
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

// +90° rotation in the plan's angle convention (atan2(z, x)); used to tell a wall's left / right faces
const rot = (u) => [-u[1], u[0]];
const dotp = (p, q) => p[0] * q[0] + p[1] * q[1];

/*
* Where a wall's two faces are, as signed distances from its drawn line along its normal (thickness side):
* - align undefined ('side', default): the line IS the inner face, the thickness grows on the normal side;
* - align 'center': the line is the wall's axis, half of the thickness on each side.
* { inner, outer } (inner = the face towards -normal, the side the room sees for a side-aligned wall).
*/
export function faceOffsets(wall) {
    const share = wall.align === 'center' ? 0.5 : 0;
    return { inner: -wall.thickness * share, outer: wall.thickness * (1 - share) };
}

// A wall seen from its corner `end`: direction leaving the corner, and its faces as offsets along
// rot(away): left (larger) / right (smaller), and whether the left one is the inner face
function sidesAt(wall, end) {
    const { dir, normal } = wallFrame(wall);
    const away = same(end, wall.a) ? dir : scale(dir, -1);
    const sign = dotp(rot(away), normal) > 0 ? 1 : -1;
    const { inner, outer } = faceOffsets(wall);
    const oi = inner * sign, oo = outer * sign;
    return { away, left: Math.max(oi, oo), right: Math.min(oi, oo), leftIsInner: oi > oo };
}

/*
* Footprint of a wall: { a, b, aOut, bOut, aJoined, bJoined } (2D, room space): inner face corners a / b,
* outer face corners aOut / bOut, and whether each end is joined to other walls (no end face there).
* Corners where walls meet are MITERED face by face: going around the corner, a wall's left face meets the
* next wall's right face (and its right face the previous wall's left face), whatever the walls' drawing
* direction, thickness side or alignment (side / center), and with any number of walls at the corner.
* Parallel faces (straight continuation) are cut square.
*/
export function wallFootprint(wall, walls) {
    const corner = (end) => {
        const mine = sidesAt(wall, end);
        const R = rot(mine.away);
        const square = (offset) => add(end, scale(R, offset));
        const others = walls.filter((item) => item !== wall && (same(item.a, end) || same(item.b, end))).map((item) => sidesAt(item, end));
        let left = square(mine.left), right = square(mine.right);
        if (others.length > 0) {
            // angle from this wall to each other wall, counter-clockwise in (0, 2π]
            const base = Math.atan2(mine.away[1], mine.away[0]);
            const turn = (other) => {
                let d = Math.atan2(other.away[1], other.away[0]) - base;
                while (d <= 1e-9) d += 2 * Math.PI;
                return d;
            };
            const next = others.reduce((best, other) => (turn(other) < turn(best) ? other : best));     // towards +angle
            const previous = others.reduce((best, other) => (turn(other) > turn(best) ? other : best)); // towards -angle
            const meet = (offset, other, otherOffset) =>
                intersect(square(offset), mine.away, add(end, scale(rot(other.away), otherOffset)), other.away) ?? square(offset);
            left = meet(mine.left, next, next.right);
            right = meet(mine.right, previous, previous.left);
        }
        return { inner: mine.leftIsInner ? left : right, outer: mine.leftIsInner ? right : left, joined: others.length > 0 };
    };
    const atA = corner(wall.a), atB = corner(wall.b);
    return { a: atA.inner, b: atB.inner, aOut: atA.outer, bOut: atB.outer, aJoined: atA.joined, bJoined: atB.joined };
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
export function addWall(level, a, b, id = newWallId(), justify = 'left') {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_WALL_LENGTH) return null;
    // justify (wall tool option): where the thickness goes, seen along the drawing direction a -> b on the
    // plan: 'left' (the model's default side), 'right' (same line, a and b swapped), 'center' (axis)
    const [start, end] = justify === 'right' ? [b, a] : [a, b];
    const wall = { id, a: [start[0], start[1]], b: [end[0], end[1]], thickness: DEFAULT_THICKNESS, ...(justify === 'center' ? { align: 'center' } : {}) };
    return { ...level, walls: [...level.walls, wall] };
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

// The level without wall `wallId` (floors untouched: they are rebuilt from closed perimeters later)
export function removeWall(level, wallId) {
    return { ...level, walls: level.walls.filter((wall) => wall.id !== wallId) };
}

/*
* Splits wall `wallId` in two at its middle: the first piece keeps the id (a -> middle), the second gets
* `newId` (middle -> b) and the same thickness / height. The pieces are joined at the middle (same point),
* so the new corner can then be dragged. Returns null if the pieces would be shorter than MIN_WALL_LENGTH.
*/
export function splitWall(level, wallId, newId = newWallId()) {
    const wall = level.walls.find((item) => item.id === wallId);
    if (wall == null || wallFrame(wall).length < 2 * MIN_WALL_LENGTH) return null;
    const middle = [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2];
    const { name, ...rest } = wall; // eslint-disable-line no-unused-vars -- the second piece gets no name
    const first = { ...wall, b: middle };
    const second = { ...rest, id: newId, a: middle };
    const walls = level.walls.flatMap((item) => (item.id === wallId ? [first, second] : [item]));
    return { ...level, walls };
}

// Face ids of a wall (keys of its materials in the store `surfaces`)
export const wallFaceIds = (wallId) => [`${wallId}:inner`, `${wallId}:outer`, `${wallId}:edge`];

// ---------------------------------------------------------------------------------------------------
// FLOORS FROM WALLS: every closed perimeter of walls gets a floor (polygon on the walls' drawn lines).
// ---------------------------------------------------------------------------------------------------

const pointKey = (p) => `${Math.round(p[0] / JOIN_EPSILON)}|${Math.round(p[1] / JOIN_EPSILON)}`;
const signedArea = (points) => points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0) / 2;

// Removes back-and-forth spikes (a wall sticking into a room is walked out and back): ... u v u ... -> ... u ...
function removeSpikes(points) {
    const result = [...points];
    let changed = true;
    while (changed && result.length > 2) {
        changed = false;
        for (let i = 0; i < result.length; i++) {
            const previous = result[(i - 1 + result.length) % result.length];
            const next = result[(i + 1) % result.length];
            if (pointKey(previous) === pointKey(next)) {
                // drop the spike tip and its duplicate return point
                const indices = [i, (i + 1) % result.length].sort((x, y) => y - x);
                indices.forEach((index) => result.splice(index, 1));
                changed = true;
                break;
            }
        }
    }
    return result;
}

/*
* Closed loops (bounded faces) of the wall graph: the walls are edges between their end points (corners,
* plus T-joints where a wall ends on another one);
* each face is walked by always turning to the next edge around the corner (planar face tracing). The
* unbounded outer face of each group of walls has the opposite orientation and is dropped, as are faces
* with no area (open chains, like a U). Returns polygons [[x, z], ...] (positive signed area).
*/
export function closedLoops(walls) {
    const points = new Map();     // key -> [x, z]
    const neighbors = new Map();  // key -> Set of keys
    const link = (p, q) => {
        const kp = pointKey(p), kq = pointKey(q);
        if (kp === kq) return;
        points.set(kp, p); points.set(kq, q);
        if (!neighbors.has(kp)) neighbors.set(kp, new Set());
        if (!neighbors.has(kq)) neighbors.set(kq, new Set());
        neighbors.get(kp).add(kq); neighbors.get(kq).add(kp);
    };
    // T-joints: a wall ending ON another wall's line (not at its ends) splits that edge in the graph there,
    // so the two rooms on its sides are separate loops (the walls themselves are not modified)
    const ends = walls.flatMap((wall) => [wall.a, wall.b]);
    walls.forEach((wall) => {
        const { dir, length } = wallFrame(wall);
        const stops = ends
            .map((p) => ({ p, t: (p[0] - wall.a[0]) * dir[0] + (p[1] - wall.a[1]) * dir[1] }))
            .filter(({ p, t }) => t > JOIN_EPSILON && t < length - JOIN_EPSILON
                && Math.abs((p[0] - wall.a[0]) * dir[1] - (p[1] - wall.a[1]) * dir[0]) < JOIN_EPSILON)
            .sort((s1, s2) => s1.t - s2.t)
            .map(({ p }) => p);
        [wall.a, ...stops, wall.b].forEach((point, i, chain) => { if (i > 0) link(chain[i - 1], point); });
    });

    // neighbors of each corner sorted by direction angle
    const sorted = new Map();
    for (const [key, set] of neighbors) {
        const origin = points.get(key);
        sorted.set(key, [...set].sort((k1, k2) => {
            const p1 = points.get(k1), p2 = points.get(k2);
            return Math.atan2(p1[1] - origin[1], p1[0] - origin[0]) - Math.atan2(p2[1] - origin[1], p2[0] - origin[0]);
        }));
    }

    const visited = new Set(); // half-edges "u>v"
    const loops = [];
    for (const [u, list] of sorted) {
        for (const v of list) {
            if (visited.has(`${u}>${v}`)) continue;
            const face = [];
            let from = u, to = v;
            while (!visited.has(`${from}>${to}`)) {
                visited.add(`${from}>${to}`);
                face.push(points.get(from));
                const around = sorted.get(to);
                const back = around.indexOf(from);
                const next = around[(back - 1 + around.length) % around.length]; // next edge around the corner
                from = to;
                to = next;
            }
            const polygon = removeSpikes(face);
            if (polygon.length >= 3 && signedArea(polygon) > 1e-6) loops.push(polygon);
        }
    }
    return loops;
}

// Is point p inside polygon (ray casting)?
function pointInPolygon(p, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
        if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
}

// A point surely inside the polygon (its centroid when inside, else the middle of a diagonal that is)
function interiorPoint(polygon) {
    const area = signedArea(polygon);
    let cx = 0, cz = 0;
    polygon.forEach((p, i) => {
        const q = polygon[(i + 1) % polygon.length];
        const f = cross(p, q);
        cx += (p[0] + q[0]) * f;
        cz += (p[1] + q[1]) * f;
    });
    const centroid = [cx / (6 * area), cz / (6 * area)];
    if (pointInPolygon(centroid, polygon)) return centroid;
    for (let i = 2; i < polygon.length; i++) {
        const middle = [(polygon[0][0] + polygon[i][0]) / 2, (polygon[0][1] + polygon[i][1]) / 2];
        if (pointInPolygon(middle, polygon)) return middle;
    }
    return polygon[0];
}

// The wall whose drawn line holds the segment p-q (a loop edge; with T-joints an edge can be part of a wall)
function wallOnSegment(walls, p, q) {
    return walls.find((wall) => {
        const { dir, length } = wallFrame(wall);
        const along = (r) => (r[0] - wall.a[0]) * dir[0] + (r[1] - wall.a[1]) * dir[1];
        const off = (r) => Math.abs((r[0] - wall.a[0]) * dir[1] - (r[1] - wall.a[1]) * dir[0]);
        const within = (r) => off(r) < JOIN_EPSILON && along(r) > -JOIN_EPSILON && along(r) < length + JOIN_EPSILON;
        return within(p) && within(q);
    });
}

/*
* CLEAR floor area of a room: the loop (walls' drawn lines) with each edge moved onto the face of its wall
* that looks into the room (a partition sticking into this room takes its thickness off; a centered wall
* half of it; a wall whose thickness is outside, nothing). The corners are where consecutive moved edges
* meet. The floor is then exactly the room's inner surface (bill of quantities: real m²).
*/
export function roomPolygon(loop, walls) {
    const lines = loop.map((p, i) => {
        const q = loop[(i + 1) % loop.length];
        const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const d = [(q[0] - p[0]) / length, (q[1] - p[1]) / length];
        let inward = rot(d);
        const middle = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        if (!pointInPolygon(add(middle, scale(inward, 1e-3)), loop)) inward = scale(inward, -1);
        const wall = wallOnSegment(walls, p, q);
        let shift = 0;
        if (wall) {
            const sign = dotp(inward, wallFrame(wall).normal) > 0 ? 1 : -1;
            const { inner, outer } = faceOffsets(wall);
            shift = Math.max(inner * sign, outer * sign, 0); // distance from the line to the room-side face
        }
        return { p: add(p, scale(inward, shift)), d };
    });
    return lines.map((line, i) => {
        const previous = lines[(i - 1 + lines.length) % lines.length];
        return intersect(previous.p, previous.d, line.p, line.d) ?? line.p;
    });
}

export const newFloorId = () => `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/*
* Rebuilds the floors of a level from its walls. Every closed loop (closedLoops) becomes a floor (the room's
* clear area: roomPolygon, wall footprints excluded) marked
* auto: true; it KEEPS the id (and so the material) of the old floor it lies in (matched by an interior
* point), or gets a new id. A loop inside an old floor already taken (a room split in two by a new wall)
* gets a new id and INHERITS that floor's material. Old auto floors with no loop are dropped (their
* perimeter was opened); manual floors (no auto flag, e.g. the default test room) are kept as they are.
* Returns { level, inherited: { newFloorId: oldFloorId }, removed: [floorId] } (materials: planSlice).
*/
export function rebuildFloors(level, makeId = newFloorId) {
    const loops = closedLoops(level.walls);
    const used = new Set();
    const inherited = {};
    const floors = loops.map((loop) => {
        const points = roomPolygon(loop, level.walls);
        const inside = interiorPoint(points);
        const container = level.floors.find((floor) => pointInPolygon(inside, floor.points));
        if (container && !used.has(container.id)) {
            used.add(container.id);
            return { id: container.id, points, auto: true };
        }
        const id = makeId();
        if (container) inherited[id] = container.id;
        return { id, points, auto: true };
    });
    const kept = level.floors.filter((floor) => !floor.auto && !used.has(floor.id));
    const removed = level.floors.filter((floor) => floor.auto && !used.has(floor.id)).map((floor) => floor.id);
    return { level: { ...level, floors: [...kept, ...floors] }, inherited, removed };
}
