/*
* FLOOR PLAN as data (store `plan`, saved in the environment: sync/roomSync.js, Y.Map "plan").
*
* plan: { levels: [level] } — one level for now; the model is ready for several (multi-storey projects,
*   worked on one level at a time, the others shown as a hologram later).
* level: { id, name, elevation (m), wallHeight (m), floors: [floor], walls: [wall] }
* floor: { id, points: [[x, z]], elevation? (m above the level's 0, default 0: setFloorElevation) }
* level.ceilings? : [ceiling], ceiling: { id, points: [[x, z]], height? (m above the level's 0, default the
*   level's wallHeight: setCeilingHeight; the EAVE height of a pitched one), roof? ({ ridgeHeight, eaves }:
*   a pitched ceiling, see setCeilingRoof / roofFacets) }. Floors and ceilings are both AREAS (polygons drawn with the same
*   tool): addFloor / moveFloorVertex / removeFloor / floorAt / fillRoom take the collection `key`
*   ('floors' default | 'ceilings').
* floor: { id, points: [[x, z], ...] } — polygon (room space, meters); its id is the face id of its surface.
* wall:  { id, name?, a: [x, z], b: [x, z], thickness, height?, align? }
*   a -> b is the wall's drawn line. align undefined: the line is the INNER face (the side the room sees)
*   and the thickness grows on the side of the normal (dz, -dx) / length; align 'center': the line is the
*   wall's axis (half thickness each side); align 'right': the line is the OUTER face, the thickness grows
*   towards -normal (setWallJustify moves the line between the three keeping the wall in place). Walls sharing
*   an end point are mitered face by face
*   (wallFootprint), so they meet cleanly at any angle; a free end is closed by an end face.
*   Face ids: '<wall id>:inner' | ':outer' | ':edge' (top and free ends).
*   openings?: [opening] — doors / windows cut in the wall (see OPENINGS below).
* level.underlay?: background drawing traced in the builder (see UNDERLAY below).
* ponytail: one level for now.
*/
export const DEFAULT_WALL_HEIGHT = 2.7;
export const DEFAULT_THICKNESS = 0.15;
const JOIN_EPSILON = 1e-4; // meters: end points closer than this are the same corner
const T_JOINT_SIN = Math.sin((10 * Math.PI) / 180); // walls closer than this to parallel never make a T joint
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
* - align 'center': the line is the wall's axis, half of the thickness on each side;
* - align 'right': the line is the outer face, the thickness grows towards -normal.
* { inner, outer } (inner = the face towards -normal, the side the room sees for a side-aligned wall).
*/
const ALIGN_SHARES = { left: 0, center: 0.5, right: 1 }; // share of the thickness on the -normal side of the line
export const wallJustify = (wall) => wall.align ?? 'left';
export function faceOffsets(wall) {
    const share = ALIGN_SHARES[wallJustify(wall)];
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
* Parallel faces (straight continuation) are cut square. A wall that CONTINUES STRAIGHT through the corner
* (another wall leaves it in the opposite direction: a split wall, a T or X junction) is cut square on both
* faces: the through walls stay one straight wall and a branch butts against their faces (mitering the
* through wall with the branch left a triangular hole on the far face).
* T JOINT ON AN UNSPLIT WALL: an end with no other wall at that corner but lying WITHIN another wall's
* thickness (its line, a face or in between: as closedLoops), away from that wall's ends (a traced or detected
* partition, a door's wall run on to a wall, a wall drawn up to a face), butts against that wall's near face:
* both faces stop there, no end face (joined). The wall it meets stays whole.
*/
export function wallFootprint(wall, walls) {
    const corner = (end) => {
        const mine = sidesAt(wall, end);
        const R = rot(mine.away);
        const square = (offset) => add(end, scale(R, offset));
        const others = walls.filter((item) => item !== wall && (same(item.a, end) || same(item.b, end))).map((item) => sidesAt(item, end));
        let left = square(mine.left), right = square(mine.right);
        const isThrough = others.some((other) => Math.abs(cross(mine.away, other.away)) < 1e-6 && dotp(mine.away, other.away) < 0);
        if (others.length > 0 && !isThrough) {
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
        let joined = others.length > 0;
        if (!joined) {
            // T joint on an unsplit wall: the end within another wall's thickness, strictly between its ends
            const through = walls.find((item) => {
                if (item === wall) return false;
                const { dir, normal, length } = wallFrame(item);
                const { inner, outer } = faceOffsets(item);
                const rel = sub(end, item.a);
                const t = dotp(rel, dir), across = dotp(rel, normal);
                return across >= Math.min(inner, outer) - JOIN_EPSILON && across <= Math.max(inner, outer) + JOIN_EPSILON
                    && t > JOIN_EPSILON && t < length - JOIN_EPSILON && Math.abs(cross(dir, mine.away)) > T_JOINT_SIN;
            });
            if (through) {
                const { dir, normal } = wallFrame(through);
                const { inner, outer } = faceOffsets(through);
                const offset = dotp(mine.away, normal) > 0 ? Math.max(inner, outer) : Math.min(inner, outer); // the face towards this wall
                const base = add(through.a, scale(normal, offset));
                left = intersect(square(mine.left), mine.away, base, dir) ?? left;
                right = intersect(square(mine.right), mine.away, base, dir) ?? right;
                joined = true;
            }
        }
        return { inner: mine.leftIsInner ? left : right, outer: mine.leftIsInner ? right : left, joined };
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

// Bounds of a level: { min: [x, z], max: [x, z], center, radius } (walls included). An empty level (no
// walls, no floors) gets the bounds of the default 6 x 6 m room, so sun, compass and views stay sized.
export function levelBounds(level) {
    const found = [...level.floors.flatMap((floor) => floor.points), ...level.walls.flatMap((wall) => {
        const f = wallFootprint(wall, level.walls);
        return [f.a, f.b, f.aOut, f.bOut];
    })];
    const points = found.length > 0 ? found : [[-3, -3], [3, 3]];
    const min = [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))];
    const max = [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
    const center = scale(add(min, max), 0.5);
    return { min, max, center, radius: Math.hypot(max[0] - center[0], max[1] - center[1]) };
}

/*
* Bounds of everything the project shows: the plan (levelBounds) plus its underlay drawing when there is one
* (its rectangle in plan meters, turned by its rotation). Same shape as levelBounds. Sizes the 3D view's
* zoom-out limit and the floor grid, so a big drawing or building is never cut off.
*/
export function sceneBounds(level) {
    const plan = levelBounds(level);
    const u = level.underlay;
    if (!u?.width || !u?.height || !u?.metersPerPixel) return plan;
    const hw = (u.width * u.metersPerPixel) / 2, hh = (u.height * u.metersPerPixel) / 2;
    const c = Math.cos(u.rotation ?? 0), s = Math.sin(u.rotation ?? 0);
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, z]) => [u.center[0] + x * c - z * s, u.center[1] + x * s + z * c]);
    const points = [plan.min, plan.max, ...corners];
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
* Moves the corner at `from` to `to`: every wall end on that corner moves with it, so joined walls stay
* joined. Floors are independent of the walls and stay where they are. Returns the new level, or null when a wall would become shorter
* than MIN_WALL_LENGTH (the editor keeps the last valid position).
*/
export function moveVertex(level, from, to) {
    const move = (point) => (same(point, from) ? [to[0], to[1]] : point);
    const walls = level.walls.map((wall) => (same(wall.a, from) || same(wall.b, from)
        ? { ...wall, a: move(wall.a), b: move(wall.b) }
        : wall));
    const isValid = walls.every((wall) => Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) >= MIN_WALL_LENGTH);
    if (!isValid) return null;
    return { ...level, walls };
}

/*
* The level with wall `wallId`'s drawn line moved to `justify` ('left' face | 'center' axis | 'right' face, seen
* along a -> b) WITHOUT moving the wall: faces, materials and openings stay where they are, only the line (its
* corners' anchor) changes. Walls continuing it straight (same thickness and axis: a split wall) get the same
* line, so the straight run stays one wall. Each corner moves with the line: onto the crossing of the new line
* with a non-parallel wall joined there (that wall's end slides along its own line), else just shifted.
* Returns null if a wall would become shorter than MIN_WALL_LENGTH.
* ponytail: a parallel wall of another thickness joined straight on is shifted with the corner (it tilts slightly).
*/
export function setWallJustify(level, wallId, justify) {
    const wall = level.walls.find((item) => item.id === wallId);
    if (wall == null) return null;
    const axisOf = (item) => { // a point of the wall's axis and its direction
        const { dir, normal } = wallFrame(item);
        const { inner, outer } = faceOffsets(item);
        return { point: add(item.a, scale(normal, (inner + outer) / 2)), dir };
    };
    // the straight run: walls joined end to end, parallel, same thickness, same axis
    const run = [wall];
    for (let i = 0; i < run.length; i++) {
        const base = axisOf(run[i]);
        for (const other of level.walls) {
            if (run.includes(other) || other.thickness !== wall.thickness) continue;
            const joined = [run[i].a, run[i].b].some((end) => same(end, other.a) || same(end, other.b));
            const o = axisOf(other);
            if (joined && Math.abs(cross(base.dir, o.dir)) < 1e-6 && Math.abs(cross(sub(o.point, base.point), base.dir)) < JOIN_EPSILON) run.push(other);
        }
    }
    // the new line of each run wall: the same place for all (seen from the selected wall's normal)
    const { normal: n0 } = wallFrame(wall);
    const target = ALIGN_SHARES[justify];
    const shifts = new Map(run.map((item) => {
        const { normal } = wallFrame(item);
        const share = dotp(normal, n0) > 0 ? target : 1 - target; // 'left' of the opposite direction is the other face
        const align = Object.keys(ALIGN_SHARES).find((key) => ALIGN_SHARES[key] === share);
        const delta = item.thickness * (share - ALIGN_SHARES[wallJustify(item)]);
        return [item, { shift: scale(normal, delta), align }];
    }));
    // corners: every end of the run moves to its new place, with the walls joined there
    const moves = []; // [from, to]
    for (const item of run) {
        const { dir } = wallFrame(item);
        for (const end of [item.a, item.b]) {
            if (moves.some(([from]) => same(from, end))) continue;
            const shifted = add(end, shifts.get(item).shift);
            const across = level.walls.find((other) => !run.includes(other) && (same(other.a, end) || same(other.b, end))
                && Math.abs(cross(dir, wallFrame(other).dir)) > 1e-6);
            moves.push([end, across ? (intersect(shifted, dir, across.a, wallFrame(across).dir) ?? shifted) : shifted]);
        }
    }
    const moveEnd = (point) => moves.find(([from]) => same(from, point))?.[1] ?? point;
    const walls = level.walls.map((item) => {
        const a = moveEnd(item.a), b = moveEnd(item.b);
        if (!shifts.has(item)) return a === item.a && b === item.b ? item : { ...item, a, b };
        const { align: _old, ...rest } = item;
        const { align } = shifts.get(item);
        return { ...rest, a, b, ...(align === 'left' ? {} : { align }) };
    });
    if (walls.some((item) => Math.hypot(item.b[0] - item.a[0], item.b[1] - item.a[1]) < MIN_WALL_LENGTH)) return null;
    return { ...level, walls };
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
    // openings keep their place in the world: their offset is measured from the other end now, and they
    // keep their hinge / slide side and the side they open towards (start / end and inner / outer swap with the line)
    const mirror = (o, length) => ({
        ...o,
        offset: length - o.offset,
        hinge: o.hinge === 'end' ? 'start' : 'end', // doors and windows: hinged / sliding leaves (openingLeaves)
        swing: o.swing === 'out' ? 'in' : 'out',
        ...(o.flushSide ? { flushSide: o.flushSide === 'out' ? 'in' : 'out' } : {}), // flush door: its flush face
        // the floor filling a floor-level opening stays the same room's
        ...(o.sill === 0 ? { floorSide: o.floorSide === 'out' ? 'in' : 'out' } : {})
    });
    const flipped = (wall) => (wall.openings ? { openings: wall.openings.map((o) => mirror(o, wallFrame(wall).length)) } : {});
    return { ...level, walls: level.walls.map((wall) => (wall.id === wallId ? { ...wall, a: wall.b, b: wall.a, ...flipped(wall) } : wall)) };
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
    // each opening goes to the piece holding its center (an opening across the middle is clipped there)
    const half = wallFrame(wall).length / 2;
    const openings = wall.openings ?? [];
    const first = { ...wall, b: middle, ...(wall.openings ? { openings: openings.filter((o) => o.offset < half) } : {}) };
    const second = { ...rest, id: newId, a: middle,
        ...(wall.openings ? { openings: openings.filter((o) => o.offset >= half).map((o) => ({ ...o, offset: o.offset - half })) } : {}) };
    const walls = level.walls.flatMap((item) => (item.id === wallId ? [first, second] : [item]));
    return { ...level, walls };
}

// ---------------------------------------------------------------------------------------------------
// OPENINGS (doors / windows): holes through a wall, stored IN the wall (wall.openings), so they move,
// split and flip with it and sync / undo with the plan.
// opening: { id, type: 'door' | 'window', offset, width, height, sill, hinge?, swing? } in meters: offset =
// distance from the wall's start `a` to the opening's CENTER along the drawn line; sill = bottom above the
// floor (0 = door). Doors: hinge 'start' (default, the side towards `a`) | 'end'; swing 'in' (default, the
// leaf opens on the wall's inner side, -normal) | 'out'. Floor-level openings (sill 0): floorSide 'in'
// (default) | 'out' = the room whose floor runs on through the wall's thickness under it (openingFloors).
// Doors and windows alike: operation 'swing' (hinged leaves) | 'flush' (doors only: hinged, flush with the wall,
// no casing: "porta a raso"; drawn as 'swing' in 2D; flushSide 'in' | 'out' = the face the leaf is flush with,
// default the swing side = pull, the other = push: doorModel.js) | 'slide' (doors: sliding on a wall face, the
// swing side; windows: each leaf on its own track in the reveal, all sliding over the one fixed at the
// hinge end) | 'pocket' (doors only: sliding into the wall); leaves 1..4 (default 1): see openingLeaves. Windows also have
// 'standard' (their default: the plain window symbol; a fixed sash in 3D) and 'hole' (a bare hole: no frame,
// no sash), doors 'passage' (the same for a door). openingOperation(opening) reads it.
// Open / closed in 3D is NOT stored here: store openDoors (planSlice.js), out of the undo history.
// ---------------------------------------------------------------------------------------------------
export const OPENING_DEFAULTS = {
    door: { width: 0.9, height: 2.1, sill: 0 },
    window: { width: 1.2, height: 1.4, sill: 0.9 }
};
export const MIN_LINTEL = 0.05; // meters of wall always kept above an opening (the wall's top is never cut)
export const MIN_OPENING_SIZE = 0.3; // meters: smallest width / height of an opening

export const newOpeningId = () => `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/*
* The openings of a wall as rectangles CLIPPED to the wall: [{ opening, from, to, bottom, top }] (from / to
* along the drawn line from `a`, bottom / top above the floor). Clipped when read, never in the data:
* shortening a wall hides the part of an opening past its end, lengthening it again brings it back.
* Shared by the 3D geometry and the areas (roomLayout.js), so they always agree.
*/
export function openingRects(wall, height) {
    const { length } = wallFrame(wall);
    return (wall.openings ?? []).map((opening) => ({
        opening,
        from: Math.max(0, opening.offset - opening.width / 2),
        to: Math.min(length, opening.offset + opening.width / 2),
        bottom: Math.min(opening.sill, height),
        top: Math.min(opening.sill + opening.height, height - MIN_LINTEL)
    })).filter((rect) => rect.to - rect.from > 1e-6 && rect.top - rect.bottom > 1e-6);
}

// How an opening opens, its type's default when not set: doors 'swing', windows 'standard' (a window has no
// 'pocket': an old one reads as 'slide')
export const openingOperation = (opening) => (opening.type === 'window'
    ? (opening.operation === 'pocket' ? 'slide' : opening.operation ?? 'standard')
    : opening.operation ?? 'swing');
export const MAX_LEAVES = 4;
// A pocket door has at most 2 leaves (one track: they part, one into each side of the wall)
export const openingMaxLeaves = (opening) => (opening.type === 'door' && openingOperation(opening) === 'pocket' ? 2 : MAX_LEAVES);

/*
* The LEAVES of an opening spanning from..to along its wall's line: [{ from, to, towardsStart }], equal
* widths, in order. towardsStart = the leaf's fixed side is its start-side edge: the hinge of a swing leaf,
* the side a sliding / pocket leaf slides away to. A leaf in the first half goes towards the start, one in
* the second half towards the end (a pair parts in the middle), the middle leaf of an odd count follows
* opening.hinge ('start' default | 'end'): 1 leaf = the classic single hinge choice.
*/
export function openingLeaves(opening, from, to) {
    const count = Math.min(openingMaxLeaves(opening), Math.max(1, Math.round(opening.leaves ?? 1)));
    const width = (to - from) / count;
    const middle = (count - 1) / 2;
    return Array.from({ length: count }, (_, i) => ({
        from: from + i * width,
        to: from + (i + 1) * width,
        towardsStart: i < middle || (i === middle && opening.hinge !== 'end')
    }));
}

/*
* FLOOR UNDER FLOOR-LEVEL OPENINGS (doors, French windows: sill 0): no threshold, the floor of the room on
* the opening's floorSide ('in' = the wall's inner side, -normal; 'out') runs on through the wall's
* thickness to the other face. The room is the floor found just past that face (the other side's if none
* there, e.g. an outside door; none at all = the wall keeps its threshold).
* Returns [{ wallId, openingId, floorId, points: [[x, z] x 4] }] (the patch, between the two faces).
*/
export function openingFloors(level) {
    const patches = [];
    for (const wall of level.walls) {
        const { dir, normal } = wallFrame(wall);
        const { inner, outer } = faceOffsets(wall);
        const at = (t, offset) => add(add(wall.a, scale(dir, t)), scale(normal, offset));
        for (const { opening, from, to, bottom } of openingRects(wall, wall.height ?? level.wallHeight)) {
            if (bottom > 1e-6) continue;
            const middle = (from + to) / 2;
            // just past each face (5 cm): the inner side lies towards -normal from the inner face
            const sides = {
                in: at(middle, Math.min(inner, outer) - FLOOR_PROBE),
                out: at(middle, Math.max(inner, outer) + FLOOR_PROBE)
            };
            const order = opening.floorSide === 'out' ? ['out', 'in'] : ['in', 'out'];
            const floor = order.map((side) => level.floors.find((f) => pointInPolygon(sides[side], f.points))).find(Boolean);
            if (floor == null) continue;
            patches.push({
                wallId: wall.id, openingId: opening.id, floorId: floor.id,
                points: [at(from, inner), at(to, inner), at(to, outer), at(from, outer)]
            });
        }
    }
    return patches;
}
const FLOOR_PROBE = 0.05; // meters past a wall face where the room's floor is looked for

/*
* The level with a new opening of `type` (OPENING_DEFAULTS size) on wall `wallId`, centered in the widest
* free stretch of the wall (between its ends and the other openings). Narrower than the default when the
* stretch is shorter (a 90 cm wall gets a door that fills it, to be resized); null below MIN_OPENING_SIZE.
*/
export function addOpening(level, wallId, type, id = newOpeningId()) {
    const wall = level.walls.find((item) => item.id === wallId);
    if (wall == null) return null;
    const { length } = wallFrame(wall);
    const size = OPENING_DEFAULTS[type];
    const taken = (wall.openings ?? []).map((o) => [o.offset - o.width / 2, o.offset + o.width / 2]).sort((p, q) => p[0] - q[0]);
    let best = [0, 0], cursor = 0;
    for (const [from, to] of [...taken, [length, length]]) {
        if (from - cursor > best[1] - best[0]) best = [cursor, from];
        cursor = Math.max(cursor, to);
    }
    const free = best[1] - best[0];
    if (free < MIN_OPENING_SIZE) return null;
    const opening = { id, type, offset: (best[0] + best[1]) / 2, ...size, width: Math.min(size.width, free) };
    return updateWall(level, wallId, { openings: [...(wall.openings ?? []), opening] });
}

/*
* The level with opening `openingId` of wall `wallId` merged with `patch` (e.g. { width: 1 }), or null when
* the result is not valid: smaller than MIN_OPENING_SIZE, negative sill, not entirely within the wall's line,
* closer than MIN_LINTEL to the wall's top, overlapping another opening of the wall, or a pocket door moved /
* widened where its pocket loses its room.
*/
export function updateOpening(level, wallId, openingId, patch) {
    const wall = level.walls.find((item) => item.id === wallId);
    const current = wall?.openings?.find((o) => o.id === openingId);
    if (current == null) return null;
    const next = { ...current, ...patch };
    const { length } = wallFrame(wall);
    const height = wall.height ?? level.wallHeight;
    const from = next.offset - next.width / 2, to = next.offset + next.width / 2;
    const isValid = next.width >= MIN_OPENING_SIZE - 1e-9 && next.height >= MIN_OPENING_SIZE - 1e-9 && next.sill >= 0
        && from >= -1e-9 && to <= length + 1e-9 && next.sill + next.height <= height - MIN_LINTEL + 1e-9
        && wall.openings.every((o) => o.id === openingId || o.offset + o.width / 2 <= from + 1e-9 || o.offset - o.width / 2 >= to - 1e-9);
    if (!isValid) return null;
    const result = updateWall(level, wallId, { openings: wall.openings.map((o) => (o.id === openingId ? next : o)) });
    // a pocket door is not MOVED or WIDENED into a spot without room for its pocket (pocketConflicts): refused
    // when a side that had room loses it; choosing 'pocket' in a tight spot stays allowed (a warning)
    if ((next.offset !== current.offset || next.width !== current.width) && openingOperation(current) === 'pocket') {
        const before = pocketConflicts(level, wallId, openingId) ?? [];
        if ((pocketConflicts(result, wallId, openingId) ?? []).some((side) => !before.includes(side))) return null;
    }
    return result;
}

/*
* RESIZE HANDLE (2D plan): the level with one EDGE of the opening ('start' | 'end': its side towards the wall's
* a / b) moved to `t` meters along the wall's line, the other edge fixed. `t` is clamped: never past the
* neighbor opening or the wall's end on that side, never closer than MIN_OPENING_SIZE to the other edge.
* Null when the opening is gone (or the result is invalid for another reason: updateOpening).
*/
export function resizeOpening(level, wallId, openingId, edge, t) {
    const wall = level.walls.find((item) => item.id === wallId);
    const opening = wall?.openings?.find((o) => o.id === openingId);
    if (opening == null) return null;
    const { length } = wallFrame(wall);
    const from = opening.offset - opening.width / 2, to = opening.offset + opening.width / 2;
    const others = wall.openings.filter((o) => o.id !== openingId);
    let a = from, b = to;
    if (edge === 'start') {
        const limit = Math.max(0, ...others.map((o) => o.offset + o.width / 2).filter((x) => x <= from + 1e-9));
        a = Math.min(Math.max(t, limit), to - MIN_OPENING_SIZE);
    } else {
        const limit = Math.min(length, ...others.map((o) => o.offset - o.width / 2).filter((x) => x >= to - 1e-9));
        b = Math.max(Math.min(t, limit), from + MIN_OPENING_SIZE);
    }
    return updateOpening(level, wallId, openingId, { offset: (a + b) / 2, width: b - a });
}

/*
* CLEAR DISTANCES of an opening along its wall (2D plan and 3D builder labels): from its edges to the NEAREST
* element on each side, i.e. the next opening of the same wall or, if none, the visible end of the wall's
* face (the mitered footprint: at a corner, the face of the other wall). Positions in meters along the
* wall's line: { from, to, before, after } (before <= from, after >= to); null when the opening is gone.
*/
export function openingClearances(level, wallId, openingId) {
    const wall = level.walls.find((item) => item.id === wallId);
    const opening = wall?.openings?.find((item) => item.id === openingId);
    if (opening == null) return null;
    const { dir } = wallFrame(wall);
    const footprint = wallFootprint(wall, level.walls);
    const along = (p) => (p[0] - wall.a[0]) * dir[0] + (p[1] - wall.a[1]) * dir[1];
    const from = opening.offset - opening.width / 2, to = opening.offset + opening.width / 2;
    const others = wall.openings.filter((item) => item.id !== openingId);
    const before = Math.max(along(footprint.a), ...others.map((o) => o.offset + o.width / 2).filter((t) => t <= from + 1e-9));
    const after = Math.min(along(footprint.b), ...others.map((o) => o.offset - o.width / 2).filter((t) => t >= to - 1e-9));
    return { from, to, before, after };
}

/*
* POCKET SPACE of a pocket door: the leaves sliding to each side need, on that side, a stretch of free wall as
* long as they are (the pocket). It is NOT free if it runs past the next opening of the wall or the visible
* end of its face (openingClearances: a corner, a free end), or across a wall joined at a T anywhere along
* it (an end within this wall's thickness, on either face). Only a warning (2D: red pocket, panel message):
* nothing is blocked. Returns the sides without room, e.g. ['start'], [] when it fits; null when the
* opening is not a pocket door (or is gone).
*/
export function pocketConflicts(level, wallId, openingId) {
    const wall = level.walls.find((item) => item.id === wallId);
    const opening = wall?.openings?.find((item) => item.id === openingId);
    if (opening == null || opening.type !== 'door' || openingOperation(opening) !== 'pocket') return null;
    const { before, after, from, to } = openingClearances(level, wallId, openingId);
    const leaves = openingLeaves(opening, from, to);
    const need = (towardsStart) => leaves.filter((leaf) => leaf.towardsStart === towardsStart).reduce((sum, leaf) => sum + leaf.to - leaf.from, 0);
    // the stretches along this wall's line taken by walls joined at a T (ends within its thickness, away from its ends)
    const { dir, normal, length } = wallFrame(wall);
    const { inner, outer } = faceOffsets(wall);
    const joints = level.walls.filter((item) => item !== wall).flatMap((item) => {
        const sin = Math.abs(cross(dir, wallFrame(item).dir));
        if (sin < T_JOINT_SIN) return [];
        return [item.a, item.b].flatMap((end) => {
            const rel = sub(end, wall.a);
            const t = dotp(rel, dir), across = dotp(rel, normal);
            if (across < Math.min(inner, outer) - JOIN_EPSILON || across > Math.max(inner, outer) + JOIN_EPSILON) return [];
            if (t <= JOIN_EPSILON || t >= length - JOIN_EPSILON) return [];
            const half = item.thickness / 2 / sin;
            return [[t - half, t + half]];
        });
    });
    const blocked = (a, b) => joints.some(([j0, j1]) => j1 > a + 1e-6 && j0 < b - 1e-6);
    const sides = [];
    const toStart = need(true), toEnd = need(false);
    if (toStart > 0 && (from - toStart < before - 1e-6 || blocked(from - toStart, from))) sides.push('start');
    if (toEnd > 0 && (to + toEnd > after + 1e-6 || blocked(to, to + toEnd))) sides.push('end');
    return sides;
}

// The level without opening `openingId` of wall `wallId`
export function removeOpening(level, wallId, openingId) {
    const wall = level.walls.find((item) => item.id === wallId);
    return updateWall(level, wallId, { openings: (wall?.openings ?? []).filter((o) => o.id !== openingId) });
}

// ---------------------------------------------------------------------------------------------------
// UNDERLAY: a floor plan drawing (image, PDF page or DXF) shown under the plan to trace walls over it.
// level.underlay = { url, kind: 'image' | 'pdf' | 'dxf', width, height (pixels of the stored image), dpi, downscale,
//   scale, metersPerPixel, center: [x, z] (plan point under the image center), rotation (radians) }
// - Nominal scale (default): the drawing is at 1:`scale` on paper; a stored pixel is 1 / (dpi x downscale)
//   inches of paper (dpi: of the original image, or 72 for a PDF, whose units are points; downscale: stored
//   pixels per original pixel / point). metersPerPixel = 0.0254 / (dpi x downscale) x scale.
// - Two-point calibration sets metersPerPixel directly (scale = null).
// - kind 'dxf' (CAD drawing, vectors: plan/dxfUnderlay.js): the file is JSON line segments per layer, in
//   drawing units centered on the drawing; width / height = drawing size in units; `units` ('mm', 'cm', 'm',
//   'in', 'ft': read from the file or chosen in the panel) gives metersPerPixel = meters per unit (exact
//   scale, no dpi / scale); `layers`: the layer names, `hiddenLayers`: the ones switched off (saved, shared).
//   A VECTOR PDF is stored the same way with source 'pdf': units are points, dpi 72 / downscale 1 / scale give
//   metersPerPixel like a raster PDF (no `units`).
// The image file lives in R2 (server/src/underlays.js); visibility and opacity are per device (workspace).
// ---------------------------------------------------------------------------------------------------
export const UNDERLAY_DEFAULTS = { scale: 100, dpi: 150 };

// Meters per stored pixel at the nominal scale ({ dpi, downscale, scale })
export const nominalMetersPerPixel = ({ dpi, downscale, scale }) => (0.0254 / (dpi * downscale)) * scale;

/*
* Underlay adjustments (builder tools, two clicks each, plan points [x, z]); each returns the new underlay.
* Rotations follow the plan's axes (x right, z down on screen): a positive angle turns clockwise on screen,
* like the 2D view's SVG rotate().
*/
const turn = (p, origin, angle) => {
    const dx = p[0] - origin[0], dz = p[1] - origin[1];
    const c = Math.cos(angle), s = Math.sin(angle);
    return [origin[0] + dx * c - dz * s, origin[1] + dx * s + dz * c];
};

// CALIBRATE: the drawing's a -> b is really `length` meters: rescaled around a (a stays put); the nominal
// scale no longer applies (scale null = calibrated). Null for coincident points or a non-positive length.
export function calibrateUnderlay(underlay, a, b, length) {
    const measured = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(measured > 1e-6) || !(length > 0)) return null;
    const k = length / measured;
    return {
        ...underlay,
        scale: null,
        metersPerPixel: underlay.metersPerPixel * k,
        center: [a[0] + (underlay.center[0] - a[0]) * k, a[1] + (underlay.center[1] - a[1]) * k]
    };
}

// ALIGN: turns the drawing around a so that its line a -> b lies on the nearest plan axis (horizontal or
// vertical). Null for coincident points.
export function alignUnderlay(underlay, a, b) {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return null;
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const delta = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2) - angle;
    return { ...underlay, rotation: underlay.rotation + delta, center: turn(underlay.center, a, delta) };
}

// MOVE: the drawing's point `from` goes to `to`
export function moveUnderlay(underlay, from, to) {
    return { ...underlay, center: [underlay.center[0] + to[0] - from[0], underlay.center[1] + to[1] - from[1]] };
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
    // T-joints: a wall ending ON another wall (not at its ends) splits that edge in the graph there, so the
    // two rooms on its sides are separate loops (the walls themselves are not modified). "On" = anywhere
    // within the other wall's thickness (on its drawn line, on either face or between them): the end is
    // projected onto that wall's line. A partition drawn up to the far face of a wall, or traced on a CAD
    // drawing, still closes its rooms.
    // An end lying within the END of another wall's footprint (a doorway that butts on a corner wall right where
    // that wall ends) attaches to that wall's end point, so the corner closes the loop there too.
    const attach = (p, owner) => {
        for (const wall of walls) {
            if (wall === owner) continue;
            const { dir, normal, length } = wallFrame(wall);
            const rel = sub(p, wall.a);
            const t = dotp(rel, dir);
            if (t < -JOIN_EPSILON || t > length + JOIN_EPSILON) continue;
            const across = dotp(rel, normal);
            const { inner, outer } = faceOffsets(wall);
            if (across < Math.min(inner, outer) - JOIN_EPSILON || across > Math.max(inner, outer) + JOIN_EPSILON) continue;
            if (t <= JOIN_EPSILON) return wall.a;
            if (t >= length - JOIN_EPSILON) return wall.b;
            return add(wall.a, scale(dir, t));
        }
        return p;
    };
    const attached = new Map(walls.map((wall) => [wall, [attach(wall.a, wall), attach(wall.b, wall)]]));
    const ends = [...attached.values()].flat();
    walls.forEach((wall) => {
        const { dir, length } = wallFrame(wall);
        const stops = ends
            .map((p) => ({ p, t: (p[0] - wall.a[0]) * dir[0] + (p[1] - wall.a[1]) * dir[1] }))
            .filter(({ p, t }) => t > JOIN_EPSILON && t < length - JOIN_EPSILON
                && Math.abs((p[0] - wall.a[0]) * dir[1] - (p[1] - wall.a[1]) * dir[0]) < JOIN_EPSILON)
            .sort((s1, s2) => s1.t - s2.t)
            .map(({ p }) => p);
        const [a, b] = attached.get(wall);
        [a, ...stops, b].forEach((point, i, chain) => { if (i > 0) link(chain[i - 1], point); });
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
export function pointInPolygon(p, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
        if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
}

// The wall whose drawn line holds the segment p-q (a loop edge; with T-joints an edge can be part of a wall).
// The line may run past the wall's ends by up to a wall thickness: an end attached to another wall's line
// (closedLoops) is projected there from within that wall's thickness.
function wallOnSegment(walls, p, q) {
    const slack = Math.max(0, ...walls.map((wall) => wall.thickness)) + JOIN_EPSILON;
    return walls.find((wall) => {
        const { dir, length } = wallFrame(wall);
        const along = (r) => (r[0] - wall.a[0]) * dir[0] + (r[1] - wall.a[1]) * dir[1];
        const off = (r) => Math.abs((r[0] - wall.a[0]) * dir[1] - (r[1] - wall.a[1]) * dir[0]);
        const within = (r) => off(r) < JOIN_EPSILON && along(r) > -slack && along(r) < length + slack;
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
export const MIN_FLOOR_AREA = 0.01; // m²: a drawn floor smaller than this is refused

// True when the open segments p1-p2 and q1-q2 properly cross (touching at an end does not count)
function segmentsCross(p1, p2, q1, q2) {
    const d1 = cross(sub(p2, p1), sub(q1, p1)), d2 = cross(sub(p2, p1), sub(q2, p1));
    const d3 = cross(sub(q2, q1), sub(p1, q1)), d4 = cross(sub(q2, q1), sub(p2, q1));
    return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
}

/*
* The points of a valid floor polygon (`points`: [x, z], either winding), consecutive duplicates dropped,
* or null when it is not one: fewer than 3 points, area under MIN_FLOOR_AREA, or edges crossing each other.
*/
function floorPolygon(points) {
    const clean = points.filter((p, i) => !same(p, points[(i + 1) % points.length])).map((p) => [p[0], p[1]]);
    if (clean.length < 3 || polygonArea(clean) < MIN_FLOOR_AREA) return null;
    const n = clean.length;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbouring edges share an end
            if (segmentsCross(clean[i], clean[(i + 1) % n], clean[j], clean[(j + 1) % n])) return null;
        }
    }
    return clean;
}

// The level with a new DRAWN floor (floor tool) from the closed polygon `points` (drawing order), or null
// when it is not a valid floor (floorPolygon)
export function addFloor(level, points, id = undefined, key = 'floors') {
    id ??= key === 'ceilings' ? newCeilingId() : newFloorId();
    const clean = floorPolygon(points);
    return clean && { ...level, [key]: [...(level[key] ?? []), { id, points: clean }] };
}

// The level with vertex `index` of floor `floorId` moved to `to` (floor tool, vertex drag); null when the
// result is not a valid floor (floorPolygon: e.g. edges crossing). A vertex dropped on a neighbour merges.
export function moveFloorVertex(level, floorId, index, to, key = 'floors') {
    const areas = level[key] ?? [];
    const floor = areas.find((item) => item.id === floorId);
    const clean = floor && floorPolygon(floor.points.map((p, i) => (i === index ? to : p)));
    return clean && { ...level, [key]: areas.map((item) => (item.id === floorId ? { ...item, points: clean } : item)) };
}

/*
* FLOOR ELEVATION: floor.elevation (meters, default 0) = the floor's top above the level's walking height
* (e.g. a raised zone at +0.30). Walls and openings still start at the level's 0 (doors stay at 0 for now).
*/
export const FLOOR_ELEVATION_LIMITS = { min: -2, max: 5 };
export const floorElevation = (floor) => floor.elevation ?? 0;

// The level with floor `floorId` at `elevation` (0 drops the field), or null when out of FLOOR_ELEVATION_LIMITS
export function setFloorElevation(level, floorId, elevation) {
    const { min, max } = FLOOR_ELEVATION_LIMITS;
    if (!(elevation >= min && elevation <= max)) return null; // also rejects NaN
    return {
        ...level,
        floors: level.floors.map((floor) => {
            if (floor.id !== floorId) return floor;
            const { elevation: _old, ...rest } = floor;
            return Math.abs(elevation) < 1e-9 ? rest : { ...rest, elevation };
        })
    };
}

// The level without floor `floorId`
export const removeFloor = (level, floorId, key = 'floors') => ({ ...level, [key]: (level[key] ?? []).filter((floor) => floor.id !== floorId) });

// The floor under `point` (the smallest one, if they overlap), or null
export function floorAt(level, point, key = 'floors') {
    const hits = (level[key] ?? []).filter((floor) => pointInPolygon(point, floor.points));
    return hits.reduce((best, floor) => (best == null || polygonArea(floor.points) < polygonArea(best.points) ? floor : best), null);
}

/*
* FILL A ROOM (floor tool, double click inside a room): the level with a new floor covering the clear area
* around `point` (roomAt: bounded by the walls' footprints). Returns null when the point is not enclosed
* (or is inside a wall), or when a floor already covers it (no double floors in the bill of quantities).
*/
export function fillRoom(level, point, id = undefined, key = 'floors') {
    if ((level[key] ?? []).some((floor) => pointInPolygon(point, floor.points))) return null;
    const room = roomAt(level.walls, point);
    return room && addFloor(level, room, id, key);
}

/*
* CEILINGS (level.ceilings, drawn with the floor tool's code: planTool 'ceiling'): flat, facing down, at
* `height` above the level's 0 (default the level's wall height). Sloped roofs: next step.
*/
export const CEILING_HEIGHT_LIMITS = { min: 0.5, max: 20 };
export const newCeilingId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
export const ceilingHeight = (ceiling, level) => ceiling.height ?? level.wallHeight;

/*
* PITCHED CEILINGS (roofs, attics): ceiling.roof = { ridgeHeight (m above the level's 0, like the eave
* height), eaves: [edge indices] }, edge i = points[i] -> points[i + 1]. The two HEIGHTS are what the user
* sets (eave = ceiling.height, ridge = roof.ridgeHeight); the pitch follows from them (roofPitch, shown
* read-only). Every point of the roof is at
*     eave height + slope x its distance to the NEAREST eave line
* with slope = (ridge - eave) / the largest such distance (where the ridge is). Older roofs stored a `pitch`
* (degrees) instead of ridgeHeight: still read (roofSlope).
* (one rule for every type: on a rectangle, 1 eave = a single pitch; 2 opposite eaves = a gable roof, the
* other two sides are the gables; every side an eave = a hip roof, "4 falde"). The roof is made of one
* planar FACET per eave: the part of the polygon closer to that eave's line than to the others'.
* No roof (or no eaves) = flat.
* EDITABLE RIDGE (hip roofs on a 4-sided polygon): roof.ridge = [[x, z], [x, z]] moves / resizes the ridge
* (default: the equal-pitch one, centered: roofRidge). The ridge stays at the equal-pitch ridge HEIGHT
* (eave height + tan(pitch) x half the width) and parallel to the longest side, so every facet stays planar:
* each side rises to the ridge end(s) on its side (trapezoids on the long sides, triangles at the ends);
* the pitches then differ per facet. Invalid (an end outside the polygon, e.g. after a vertex move): the
* default ridge is used.
* ponytail: exact for CONVEX polygons (rectangles, regular shapes); on a concave one the facets are an
* approximation (a true straight skeleton would be needed for L-shaped hip roofs).
*/
export const DEFAULT_ROOF_PITCH = 30; // degrees: the ridge height a new pitched ceiling starts with
export const MAX_RIDGE_HEIGHT = 30;   // meters above the level's 0
const MIN_RISE = 0.05;                // meters: the ridge is always at least this much above the eaves
// The ceiling's eave edges still in range (a vertex merge can shorten the polygon)
export const roofEaves = (ceiling) => (ceiling.roof?.eaves ?? []).filter((i) => i < ceiling.points.length);

// Every edge of a polygon with its unit direction and its INWARD unit normal (towards the polygon)
function inwardEdges(points) {
    return points.map((p, i) => {
        const q = points[(i + 1) % points.length];
        const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const dir = [(q[0] - p[0]) / length, (q[1] - p[1]) / length];
        let n = [-dir[1], dir[0]];
        if (!pointInPolygon([(p[0] + q[0]) / 2 + n[0] * 1e-4, (p[1] + q[1]) / 2 + n[1] * 1e-4], points)) n = [-n[0], -n[1]];
        return { p, length, dir, n };
    });
}
// Signed distance of [x, z] from an edge's LINE, positive inside the polygon
const lineDistance = (edge, x) => (x[0] - edge.p[0]) * edge.n[0] + (x[1] - edge.p[1]) * edge.n[1];

// The part of polygon `points` where the linear function f(x) <= 0 (Sutherland-Hodgman, one half-plane)
function clipPolygon(points, f) {
    const out = [];
    points.forEach((a, i) => {
        const b = points[(i + 1) % points.length];
        const fa = f(a), fb = f(b);
        if (fa <= 0) out.push(a);
        if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
            const t = fa / (fa - fb);
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
    });
    return out;
}

/*
* The FACETS of a pitched ceiling, or null when it is flat: [{ edge (eave index), dir (along the eave, plan
* unit vector), points: [[x, y, z]] }], each a planar convex polygon above its part of the plan.
*/
export function roofFacets(ceiling, level) {
    const eaves = roofEaves(ceiling);
    if (eaves.length === 0) return null;
    const ridge = customRidge(ceiling);
    return ridge ? ridgeFacets(ceiling, level, ridge) : equalPitchFacets(ceiling, level, eaves);
}

// The largest distance of the polygon's points from their nearest eave line (where the ridge is), 0 if flat
function ridgeDistance(ceiling, eaves) {
    let best = 0;
    for (const facet of equalPitchFacets(ceiling, null, eaves, 1, 0)) for (const p of facet.points) best = Math.max(best, p[1]);
    return best;
}

// Rise per meter of a pitched ceiling's equal-pitch roof: from its two heights (or an old stored pitch)
function roofSlope(ceiling, level) {
    const { roof } = ceiling;
    if (roof.ridgeHeight == null) return Math.tan(((roof.pitch ?? DEFAULT_ROOF_PITCH) * Math.PI) / 180);
    const distance = ridgeDistance(ceiling, roofEaves(ceiling));
    return distance > 1e-9 ? Math.max(0, roof.ridgeHeight - ceilingHeight(ceiling, level)) / distance : 0;
}

// The ridge height of a pitched ceiling (m above the level's 0), or null when flat
export function roofRidgeHeight(ceiling, level) {
    if (roofEaves(ceiling).length === 0) return null;
    return ceiling.roof.ridgeHeight ?? ceilingHeight(ceiling, level) + roofSlope(ceiling, level) * ridgeDistance(ceiling, roofEaves(ceiling));
}

// The pitch (degrees) that follows from the two heights, or null when flat (with a moved hip ridge: the pitch
// of the centered one; the facets then differ)
export function roofPitch(ceiling, level) {
    return roofEaves(ceiling).length === 0 ? null : (Math.atan(roofSlope(ceiling, level)) * 180) / Math.PI;
}

// Equal-pitch facets: one per eave, the part of the polygon closer to its line than to the other eaves'
// (slope / base given: used with 1 / 0 to measure the ridge distance)
function equalPitchFacets(ceiling, level, eaves, slope = roofSlope(ceiling, level), base = ceilingHeight(ceiling, level)) {
    const edges = inwardEdges(ceiling.points);
    return eaves.map((i) => {
        const edge = edges[i];
        let region = ceiling.points;
        for (const j of eaves) if (j !== i) region = clipPolygon(region, (x) => lineDistance(edge, x) - lineDistance(edges[j], x));
        const points = region.map((x) => [x[0], base + slope * Math.max(0, lineDistance(edge, x)), x[1]]);
        return { edge: i, dir: edge.dir, points };
    }).filter((facet) => facet.points.length >= 3 && polygonArea(facet.points.map((p) => [p[0], p[2]])) > 1e-6);
}

// The axis ridges of a ceiling run along: its longest side's direction
function ridgeAxis(ceiling) {
    const edges = inwardEdges(ceiling.points);
    return edges.reduce((best, edge) => (edge.length > best.length + 1e-9 ? edge : best)).dir;
}
const canEditRidge = (ceiling) => roofType(ceiling) === 'hip' && ceiling.points.length === 4;

// The stored ridge when it can be used (hip on 4 sides, both ends inside the polygon), else null
function customRidge(ceiling) {
    const ridge = ceiling.roof?.ridge;
    if (!ridge || !canEditRidge(ceiling)) return null;
    return ridge.every((p) => pointInPolygon(p, ceiling.points)) ? ridge : null;
}

/*
* The RIDGE of a hip roof on 4 sides: { a, b ([x, z], a before b along the axis), height, axis, isCustom },
* or null for any other roof (not editable). Default = the equal-pitch ridge (centered).
*/
export function roofRidge(ceiling, level) {
    if (!canEditRidge(ceiling)) return null;
    const axis = ridgeAxis(ceiling);
    const facets = equalPitchFacets(ceiling, level, roofEaves(ceiling));
    const points = facets.flatMap((facet) => facet.points);
    const height = Math.max(...points.map((p) => p[1]));
    const along = (p) => p[0] * axis[0] + p[1] * axis[1];
    const custom = customRidge(ceiling);
    // default: the INNER vertices of the equal-pitch roof (off the outline: above the eaves), the two extremes
    // along the axis (one point for a square). Not "the highest points": on a plan that is not an exact
    // rectangle the two ridge ends differ by a hair in height and only one of them was kept (the ridge
    // collapsed to a point, 24/10)
    const base = ceilingHeight(ceiling, level);
    const top = points.filter((p) => p[1] > base + 1e-6).map((p) => [p[0], p[2]]);
    const [a, b] = custom ?? [top.reduce((m, p) => (along(p) < along(m) ? p : m)), top.reduce((m, p) => (along(p) > along(m) ? p : m))];
    return along(a) <= along(b) ? { a, b, height, axis, isCustom: custom != null } : { a: b, b: a, height, axis, isCustom: custom != null };
}

// Facets rising from each side to the ridge: a side whose two ends fall on the same side of the ridge's
// middle (along the axis) is a triangle to that ridge end, the others are trapezoids (planar: the ridge is
// parallel to them)
function ridgeFacets(ceiling, level, ridge) {
    const { height } = roofRidge(ceiling, level);
    const axis = ridgeAxis(ceiling);
    const base = ceilingHeight(ceiling, level);
    const along = (p) => p[0] * axis[0] + p[1] * axis[1];
    const [r0, r1] = along(ridge[0]) <= along(ridge[1]) ? ridge : [ridge[1], ridge[0]];
    const middle = (along(r0) + along(r1)) / 2;
    const ends = [[r0[0], height, r0[1]], [r1[0], height, r1[1]]];
    const endOf = (p) => (along(p) < middle ? 0 : 1);
    const edges = inwardEdges(ceiling.points);
    return ceiling.points.map((p, i) => {
        const q = ceiling.points[(i + 1) % ceiling.points.length];
        const [ea, eb] = [endOf(p), endOf(q)];
        const low = [[p[0], base, p[1]], [q[0], base, q[1]]];
        const points = ea === eb ? [...low, ends[ea]] : [...low, ends[eb], ends[ea]];
        return { edge: i, dir: edges[i].dir, points };
    }).filter((facet) => polygonArea(facet.points.map((p) => [p[0], p[2]])) > 1e-6);
}

/*
* Height of a pitched (or flat) ceiling above plan point [x, z] (the walls below it are cut there). The roofs
* here are tent-shaped (every facet plane above the others outside its own part), so the height is the
* LOWEST of the facet planes at that point: exact inside the polygon and on its outline.
*/
export function roofHeightAt(ceiling, level, x) {
    const facets = roofFacets(ceiling, level);
    if (facets == null) return ceilingHeight(ceiling, level);
    return Math.min(...facets.map(({ points }) => {
        const n = facetNormal(points);
        const [x0, y0, z0] = points[0];
        return y0 - (n[0] * (x[0] - x0) + n[2] * (x[1] - z0)) / n[1];
    }));
}

// Unit normal of a planar facet (3D points), pointing up (y > 0); Newell's method (robust to collinear points)
export function facetNormal(points) {
    let nx = 0, ny = 0, nz = 0;
    points.forEach((p, i) => {
        const q = points[(i + 1) % points.length];
        nx += (p[1] - q[1]) * (p[2] + q[2]);
        ny += (p[2] - q[2]) * (p[0] + q[0]);
        nz += (p[0] - q[0]) * (p[1] + q[1]);
    });
    const length = Math.hypot(nx, ny, nz) * Math.sign(ny || 1);
    return [nx / length, ny / length, nz / length];
}

// True area of a planar facet (3D points)
export function facetArea(points) {
    let nx = 0, ny = 0, nz = 0;
    points.forEach((p, i) => {
        const q = points[(i + 1) % points.length];
        nx += (p[1] - q[1]) * (p[2] + q[2]);
        ny += (p[2] - q[2]) * (p[0] + q[0]);
        nz += (p[0] - q[0]) * (p[1] + q[1]);
    });
    return Math.hypot(nx, ny, nz) / 2;
}

/*
* EXPOSED BEAMS (travi a vista) of a hip roof with a ridge (roofRidge): roof.beams = count (>= 2; none when
* missing). The beams are spread evenly along the ridge, PERPENDICULAR to it: the first and last at the
* ridge's ends (inset by half a section, so they stay under their facet), each running from the ridge down
* to the two long eaves, hung under the roof (section BEAM_SIZE: width along the ridge, depth square to the
* roof's plane). The small end facets get none for now.
* HIP BEAMS (diagonali, kind 'hip'): with the beams, one more along each hip line, from the ridge end to the
* roof's corner (same section, plumb ends, the side faces vertical). The hip line is a fold of the roof's
* underside, so a flat-topped hip beam is LOWERED until its top edges touch the two facets (no corner
* sticking through the roof). ponytail: the hip beam's corner end is cut square to it in plan, so its width
* juts a few cm past the two eaves at the corner (a real one is cut on both eave planes: later, if visible).
* roofBeams(ceiling, level) -> [{ kind ('rafter' | 'hip'), top: [upper point, lower point] ([x, y, z]: the
* middle of the beam's TOP), across: [x, 0, z] (unit, horizontal, square to the beam in plan), down: [x, y, z]
* (unit, square to the beam, downwards), depth (m: BEAM_SIZE.depth, hip beams BEAM_SIZE.hipDepth; the top
* stays against the roof either way) }], [] when none.
* Both ends are cut plumb (roomLayout.beamsGeometry): the two beams of a position meet on the ridge's vertical
* plane, and end on the eave's. ponytail: the eave sides must be parallel to the ridge (rectangles), others
* get no beams.
*/
export const BEAM_SIZE = { width: 0.14, depth: 0.3, hipDepth: 0.23 }; // meters (hip beams: shallower)
export const BEAM_COUNT_LIMITS = { min: 2, max: 60 };
export const beamsFaceId = (ceilingId) => `${ceilingId}~beams`; // the beams' own surface (material, bill)

export function roofBeams(ceiling, level) {
    const count = ceiling.roof?.beams;
    const ridge = count ? roofRidge(ceiling, level) : null;
    if (!ridge) return [];
    const base = ceilingHeight(ceiling, level);
    const rise = ridge.height - base;
    const { axis } = ridge;
    // the two eaves parallel to the ridge (inward edges): the beams run down to them
    const eaves = inwardEdges(ceiling.points).filter((edge) => Math.abs(edge.dir[0] * axis[0] + edge.dir[1] * axis[1]) > 1 - 1e-6);
    if (eaves.length !== 2 || rise <= 0) return [];
    const length = Math.hypot(ridge.b[0] - ridge.a[0], ridge.b[1] - ridge.a[1]);
    const inset = Math.min(BEAM_SIZE.width / 2, length / 2);
    const positions = Array.from({ length: count }, (_, i) => inset + (count > 1 ? (i * (length - 2 * inset)) / (count - 1) : 0));
    return [...new Set(positions.map((t) => t.toFixed(6)))].map(Number).flatMap((t) => {
        const r = [ridge.a[0] + axis[0] * t, ridge.a[1] + axis[1] * t];
        return eaves.map((edge) => {
            const d = lineDistance(edge, r); // plan distance from the ridge point down to this eave
            const e = [r[0] - edge.n[0] * d, r[1] - edge.n[1] * d];
            // the facet's up normal: the roof RISES by `rise` over `d` along n (inward, towards the ridge), so the
            // normal leans the other way, towards the eave: (-n k, 1) normalized
            const k = rise / d, l = Math.hypot(k, 1);
            const up = [-edge.n[0] * k / l, 1 / l, -edge.n[1] * k / l];
            return { kind: 'rafter', depth: BEAM_SIZE.depth, top: [[r[0], ridge.height, r[1]], [e[0], base, e[1]]], across: [axis[0], 0, axis[1]], down: up.map((c) => -c) };
        });
    }).concat(hipBeams(ceiling, level, ridge, base));
}

// The 4 hip beams (see roofBeams): each corner to the ridge end on its side (the same rule as ridgeFacets)
function hipBeams(ceiling, level, ridge, base) {
    const { a, b, axis, height } = ridge;
    const along = (p) => p[0] * axis[0] + p[1] * axis[1];
    const middle = (along(a) + along(b)) / 2;
    const half = BEAM_SIZE.width / 2;
    return ceiling.points.map((corner) => {
        const end = along(corner) < middle ? a : b;
        const run = Math.hypot(corner[0] - end[0], corner[1] - end[1]);
        const plan = [(corner[0] - end[0]) / run, (corner[1] - end[1]) / run];
        const across = [-plan[1], 0, plan[0]];
        // lowered until the top's edges (half a width each side of the hip line) are on the facets
        const mid = [(corner[0] + end[0]) / 2, (corner[1] + end[1]) / 2];
        const edgeHeight = Math.min(...[-1, 1].map((s) => roofHeightAt(ceiling, level, [mid[0] + across[0] * s * half, mid[1] + across[2] * s * half])));
        const drop = Math.max(0, roofHeightAt(ceiling, level, mid) - edgeHeight);
        const top = [[end[0], height - drop, end[1]], [corner[0], base - drop, corner[1]]];
        // down: square to the beam in its vertical plane (across x along, pointing down)
        const d = [top[1][0] - top[0][0], top[1][1] - top[0][1], top[1][2] - top[0][2]];
        let down = [across[1] * d[2] - across[2] * d[1], across[2] * d[0] - across[0] * d[2], across[0] * d[1] - across[1] * d[0]];
        const length = Math.hypot(...down) * (down[1] > 0 ? -1 : 1);
        down = down.map((c) => c / length);
        return { kind: 'hip', depth: BEAM_SIZE.hipDepth, top, across, down };
    });
}

// The level with ceiling `ceilingId`'s beam count (0 = none), or null when out of BEAM_COUNT_LIMITS / no roof
export function setRoofBeams(level, ceilingId, count) {
    const ceilings = level.ceilings ?? [];
    const ceiling = ceilings.find((item) => item.id === ceilingId);
    if (!ceiling?.roof || !Number.isInteger(count)) return null;
    if (count !== 0 && !(count >= BEAM_COUNT_LIMITS.min && count <= BEAM_COUNT_LIMITS.max)) return null;
    const { beams: _old, ...roof } = ceiling.roof;
    return { ...level, ceilings: ceilings.map((item) => (item.id === ceilingId ? { ...item, roof: count ? { ...roof, beams: count } : roof } : item)) };
}

/*
* DORMERS (abbaini) on a pitched ceiling: roof.dormers = [{ id, eave, t, width, setback, eaveHeight,
* ridgeHeight }]. A gable dormer standing on the facet of eave `eave` (any facet), its ridge HORIZONTAL and
* square to that eave:
* - t: the dormer's axis along the eave (meters from the eave's start point), width: between its cheeks;
* - setback: from the eave line to the dormer's front (0 = flush with the eave);
* - eaveHeight / ridgeHeight: its own eave and ridge, m above the level's 0 like the roof's (the pitch of its
*   two small facets follows);
* - hipOffset (optional): hip mode, the two heights derived instead (resolveDormer).
* In plan (dormerLines) it is three lines square to the eave: the two cheeks (the width) and the ridge. The
* facet under it rises by k per meter from its eave (facetSlope), so every plan distance d from the eave is a
* roof height base + k d: the cheeks run from the front back to where the roof reaches the dormer's eave
* height, the ridge to where it reaches the ridge height (the dormer's roof meets the main one there). So the
* ridge's LENGTH and the ridge HEIGHT are the same thing seen twice: dragging the ridge's back end sets the
* height, and the other way round.
* In 3D (dormerSolids): two triangular CHEEKS and two small roof facets reaching back to the valley lines
* where they meet the main roof. The FRONT is left OPEN (Flavio, 24/10): the wall with its windows there is
* placed by the user (dormerSolids.front gives its outline for that later). The main facet is OPEN under the dormer (dormerFootprint:
* the hole, so the dormer's room is seen from inside).
*/
export const DORMER_LIMITS = { minWidth: 0.4, minWall: 0.05 }; // m: narrowest dormer; front wall / rise above
export const newDormerId = () => `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// Rise per meter (square to the eave) of the facet of eave `eave`, and its depth (largest distance of its
// points from the eave line): from the facet's plane, so it holds for moved hip ridges too. null: no facet
function facetSlope(ceiling, level, eave) {
    const facet = (roofFacets(ceiling, level) ?? []).find((item) => item.edge === eave);
    if (!facet) return null;
    const edge = inwardEdges(ceiling.points)[eave];
    const [nx, ny, nz] = facetNormal(facet.points);
    const k = (-nx / ny) * edge.n[0] + (-nz / ny) * edge.n[1];
    const depth = Math.max(...facet.points.map((p) => lineDistance(edge, [p[0], p[2]])));
    return { edge, k, depth, base: ceilingHeight(ceiling, level) };
}

/*
* A dormer's PLAN lines, or null when it does not fit (see dormerFits): { front: [left, right], cheeks:
* [[front, back], [front, back]], ridge: [front, back], frontHeight (the main roof's height along the front),
* k (the facet's slope), edge }. Points [x, z]; "left" = towards the eave's start point.
*/
export function dormerLines(ceiling, level, dormer) {
    const facet = facetSlope(ceiling, level, dormer.eave);
    if (!facet || facet.k <= 1e-6) return null;
    const { edge, k, base } = facet;
    const at = (along, inward) => [edge.p[0] + edge.dir[0] * along + edge.n[0] * inward, edge.p[1] + edge.dir[1] * along + edge.n[1] * inward];
    const sideDistance = (dormer.eaveHeight - base) / k;  // where the roof reaches the dormer's eave height
    const ridgeDistance = (dormer.ridgeHeight - base) / k; // ... its ridge height
    const half = dormer.width / 2;
    return {
        edge, k, depth: facet.depth,
        frontHeight: base + k * dormer.setback,
        sideDistance, ridgeDistance,
        front: [at(dormer.t - half, dormer.setback), at(dormer.t + half, dormer.setback)],
        cheeks: [-1, 1].map((s) => [at(dormer.t + s * half, dormer.setback), at(dormer.t + s * half, sideDistance)]),
        ridge: [at(dormer.t, dormer.setback), at(dormer.t, ridgeDistance)]
    };
}

// True when the dormer fits its facet: inside the eave's length, a front wall above the roof, an eave below
// the ridge, its ridge meeting the roof before the facet ends
export function dormerFits(ceiling, level, dormer) {
    const facet = facetSlope(ceiling, level, dormer.eave);
    if (!facet || facet.k <= 1e-6) return false;
    const { edge, k, depth, base } = facet;
    const { minWidth, minWall } = DORMER_LIMITS;
    const ridgeDistance = (dormer.ridgeHeight - base) / k;
    return dormer.width >= minWidth - 1e-9
        && dormer.t - dormer.width / 2 >= -1e-9 && dormer.t + dormer.width / 2 <= edge.length + 1e-9
        && dormer.setback >= -1e-9
        && dormer.eaveHeight >= base + k * dormer.setback + minWall - 1e-9 // a front wall
        && dormer.ridgeHeight >= dormer.eaveHeight + minWall - 1e-9         // a pitched roof
        && ridgeDistance <= depth + 1e-9;                                   // meets the roof inside the facet
}

/*
* A dormer's SOLIDS for the 3D, or null when it does not fit: { roofs: [{ dir, points }] (the two small
* facets, same shape as roofFacets: dir = along the dormer's eaves), walls: [{ normal, along, points }]
* (the two cheeks: outward normal, horizontal direction along the wall, for the UVs), front: the open gable's
* outline (not built) }.
* Points [x, y, z]. Frame: a = along the main eave, d = in from it (planModel inward normal), y = height.
*/
export function dormerSolids(ceiling, level, dormer) {
    if (!dormerFits(ceiling, level, dormer)) return null;
    const { edge, k, frontHeight, sideDistance, ridgeDistance } = dormerLines(ceiling, level, dormer);
    const P = (a, d, y) => [edge.p[0] + edge.dir[0] * a + edge.n[0] * d, y, edge.p[1] + edge.dir[1] * a + edge.n[1] * d];
    const { t, setback: sb, eaveHeight: e, ridgeHeight: h } = dormer;
    const w = dormer.width / 2;
    const along3 = [edge.dir[0], 0, edge.dir[1]], in3 = [edge.n[0], 0, edge.n[1]];
    return {
        // each small facet: its eave (a = t -/+ w, at the eave height), the ridge (a = t, at the ridge height),
        // back to the valley: from where the main roof reaches the eave height to where it reaches the ridge's
        roofs: [-1, 1].map((s) => ({ dir: edge.n, points: [P(t + s * w, sb, e), P(t, sb, h), P(t, ridgeDistance, h), P(t + s * w, sideDistance, e)] })),
        // cheeks: triangles between the main roof, the dormer's eave line and the front
        walls: [-1, 1].map((s) => ({ normal: along3.map((c) => s * c), along: in3, points: [P(t + s * w, sb, frontHeight), P(t + s * w, sb, e), P(t + s * w, sideDistance, e)] })),
        // the OPEN front (gable): from the main roof (horizontal there: the front is parallel to the eave) up to
        // the eaves and the ridge; not built
        front: { normal: in3.map((c) => -c), along: along3, points: [P(t - w, sb, frontHeight), P(t + w, sb, frontHeight), P(t + w, sb, e), P(t, sb, h), P(t - w, sb, e)] }
    };
}
/*
* The plan outline of what a dormer covers on its facet, the HOLE cut in the main roof (roomLayout.js):
* [front left, front right, right cheek's back, ridge's back, left cheek's back], [x, z]; null when it does
* not fit. ponytail: a dormer reaching past its facet (a hip line) is cut on its own facet only.
*/
export function dormerFootprint(ceiling, level, dormer) {
    if (!dormerFits(ceiling, level, dormer)) return null;
    const { front, cheeks, ridge } = dormerLines(ceiling, level, dormer);
    return [front[0], front[1], cheeks[1][1], ridge[1], cheeks[0][1]];
}

/*
* The DORMER over plan point `p` of a ceiling: { dormer, heightAt([x, z]) } (heightAt: its roof's underside,
* ridge height minus its pitch x the distance from its axis; valid inside its footprint), or null when no
* dormer covers p. Used by the walls (roomLayout wallTops): under a dormer their top follows its roof.
*/
export function dormerAt(ceiling, level, p) {
    for (const dormer of roofDormers(ceiling, level)) {
        const footprint = dormerFootprint(ceiling, level, dormer);
        if (!footprint || !pointInPolygon(p, footprint)) continue;
        const { edge } = dormerLines(ceiling, level, dormer);
        const pitch = (dormer.ridgeHeight - dormer.eaveHeight) / (dormer.width / 2);
        const offAxis = (q) => Math.abs((q[0] - edge.p[0]) * edge.dir[0] + (q[1] - edge.p[1]) * edge.dir[1] - dormer.t);
        return { dormer, heightAt: (q) => dormer.ridgeHeight - pitch * offAxis(q) };
    }
    return null;
}

/*
* DORMER BEAMS (with the roof's exposed beams on: roof.beams), DORMER_BEAM_SIZE square section:
* - two VALLEY beams (kind 'valley') along the lines where the dormer's roof meets the main one: from the
*   dormer ridge's back end down to its cheeks' back ends, and ON along the same line (it lies in the main
*   roof's plane, so it stays under the roof) to the first WALL face it meets in plan, cut flush on that face
*   (it rests on the wall); with no wall ahead (within the ceiling) it stops at the cheek's back end;
* - a HEADER (kind 'header', trave di testa): horizontal, parallel to the main eave, where the dormer's ridge
*   meets the roof, its top on the main roof; it spans the bay the dormer stands in: on each side of the
*   dormer's axis it runs to the first roof beam its line crosses (`rafters`: roofBeams of the ceiling,
*   rafters AND hip beams: a dormer on a hip's end facet sits between two hip beams) and is CUT on that beam's
*   side face (any angle); with no beam on a side it stops at the dormer's cheek.
* - the valleys are cut on the header's front face and, between themselves, on the dormer's axis plane.
* Same shape as roofBeams entries ({ kind, top, across, down, depth, width }) plus `clips`: [{ point, normal }]
* vertical planes the solid is cut by, keeping the side where (p - point) . normal <= 0 (roomLayout).
*/
// meters: valleys 15 x 15 at most; the HEADER is deeper (20) so the valleys, whose top is already lower at the
// joint, still get about their full depth above its bottom (as in carpentry: the header is the deeper member)
export const DORMER_BEAM_SIZE = { width: 0.15, depth: 0.15, headerDepth: 0.2 };
const VALLEY_LIFT = 0.005; // m: the valleys' bottom this much above the header's at the joint (never below it)

// Where a valley running from `from` through `through` (3D, its top line) meets the first wall face beyond
// `through` in plan (inside the ceiling): { point (3D, on the line), clip (the face's vertical plane, keeping
// the valley's side) }, or null. The line goes on past `through` (beyond: at most the ceiling's outline).
function valleyWallStop(level, ceiling, from, through) {
    const p0 = [from[0], from[2]], p1 = [through[0], through[2]];
    const d = [p1[0] - p0[0], p1[1] - p0[1]];
    const run = Math.hypot(d[0], d[1]);
    if (run < 1e-9) return null;
    let best = null;
    for (const wall of level.walls) {
        const f = wallFootprint(wall, level.walls);
        for (const [q0, q1] of [[f.a, f.b], [f.aOut, f.bOut]]) {
            const e = [q1[0] - q0[0], q1[1] - q0[1]];
            const den = d[0] * e[1] - d[1] * e[0];
            if (Math.abs(den) < 1e-12) continue;
            const w = [q0[0] - p0[0], q0[1] - p0[1]];
            const s = (w[0] * e[1] - w[1] * e[0]) / den;  // along the valley (1 = `through`)
            const u = (w[0] * d[1] - w[1] * d[0]) / den;  // along the face
            if (s <= 1 - 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
            const hit = [p0[0] + d[0] * s, p0[1] + d[1] * s];
            if (!pointInPolygon(hit, ceiling.points)) continue;
            if (best === null || s < best.s) best = { s, e, hit };
        }
    }
    if (!best) return null;
    // the beam's box runs ON past the face (by its own width, plenty for any angle under ~80 degrees) and the
    // face's plane cuts it: the whole end lies on the wall, its outer edge included (an oblique valley's square
    // end left that corner short of the wall)
    const past = best.s + DORMER_BEAM_SIZE.width / run;
    const point = [0, 1, 2].map((j) => from[j] + (through[j] - from[j]) * past);
    // the face's vertical plane; normal pointing away from the valley's start (keep the valley's side)
    const length = Math.hypot(best.e[0], best.e[1]);
    let n = [-best.e[1] / length, best.e[0] / length];
    if (n[0] * d[0] + n[1] * d[1] < 0) n = [-n[0], -n[1]];
    return { point, clip: { point: [best.hit[0], 0, best.hit[1]], normal: [n[0], 0, n[1]] } };
}

export function dormerBeams(ceiling, level, rafters = []) {
    if (!ceiling.roof?.beams) return [];
    return roofDormers(ceiling, level).flatMap((dormer) => {
        if (!dormerFits(ceiling, level, dormer)) return [];
        const { edge, k, sideDistance, ridgeDistance } = dormerLines(ceiling, level, dormer);
        const P = (a, d, y) => [edge.p[0] + edge.dir[0] * a + edge.n[0] * d, y, edge.p[1] + edge.dir[1] * a + edge.n[1] * d];
        const along = (p) => (p[0] - edge.p[0]) * edge.dir[0] + (p[2] - edge.p[1]) * edge.dir[1];
        const { t, eaveHeight: e, ridgeHeight: h } = dormer;
        const w = dormer.width / 2;
        const { width, depth } = DORMER_BEAM_SIZE;
        const top = P(t, ridgeDistance, h);
        const in3 = [edge.n[0], 0, edge.n[1]], dir3 = [edge.dir[0], 0, edge.dir[1]];
        // the header hangs square to the main roof (its sides lean with the roof): down vector and front face plane
        // (through its front top edge, containing the eave direction and `down`), normal pointing into the header
        const l = Math.hypot(k, 1);
        const headerDown = [edge.n[0] * k / l, -1 / l, edge.n[1] * k / l];
        const frontNormal = (() => {
            const [a, b] = [dir3, headerDown];
            let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
            if (n[0] * in3[0] + n[2] * in3[2] < 0) n = n.map((c) => -c);
            const length = Math.hypot(...n);
            return n.map((c) => c / length);
        })();
        const headerFront = { point: P(t, ridgeDistance - width / 2, h), normal: frontNormal };
        // valleys: down square to the beam in its vertical plane (sides vertical); a valley is a fold DOWN in the
        // roof's underside, so a flat top centred on it stays under both roofs (no drop needed). From the ridge's
        // back end, cut on the header's front face and on the axis plane (each keeps its own side)
        const valleys = [-1, 1].map((s) => {
            const cheekBack = P(t + s * w, sideDistance, e);
            const wallStop = valleyWallStop(level, ceiling, top, cheekBack);
            const bottom = wallStop ? wallStop.point : cheekBack;
            const run = Math.hypot(bottom[0] - top[0], bottom[2] - top[2]);
            const across = [-(bottom[2] - top[2]) / run, 0, (bottom[0] - top[0]) / run];
            const d = [bottom[0] - top[0], bottom[1] - top[1], bottom[2] - top[2]];
            let down = [across[1] * d[2] - across[2] * d[1], across[2] * d[0] - across[0] * d[2], across[0] * d[1] - across[1] * d[0]];
            const length = Math.hypot(...down) * (down[1] > 0 ? -1 : 1);
            down = down.map((c) => c / length);
            const axisPlane = { point: P(t, 0, 0), normal: dir3.map((c) => -s * c) };
            // depth: at the JOINT (the header's front face) the valley's bottom stays VALLEY_LIFT above the header's
            // bottom. There the valley's top is already lower than the header's (it falls from the ridge's back end
            // along the valley), so its depth is what is left between that top and the header's bottom
            // (the slope and the inward run are taken along the whole valley: it may go on past the cheek to a wall)
            const bottomIn = lineDistance(edge, [bottom[0], bottom[2]]);
            const toJoint = (width / 2) * run / Math.max(1e-9, ridgeDistance - bottomIn); // plan run to the face
            const jointTop = h - (h - bottom[1]) / run * toJoint;
            const headerBottom = h - DORMER_BEAM_SIZE.headerDepth / l; // header: top at h, drops depth x cos(pitch)
            const room = (jointTop - headerBottom - VALLEY_LIFT) / Math.abs(down[1]);
            const valleyDepth = Math.max(0.02, Math.min(depth, room));
            return { kind: 'valley', top: [top, bottom], across, down, depth: valleyDepth, width, clips: [headerFront, axisPlane, ...(wallStop ? [wallStop.clip] : [])] };
        });
        // header: on each side of the axis, the nearest roof beam (rafter or hip) its line crosses; cut on that
        // beam's side face towards the dormer
        const headerAt = (a) => [edge.p[0] + edge.dir[0] * a + edge.n[0] * ridgeDistance, edge.p[1] + edge.dir[1] * a + edge.n[1] * ridgeDistance];
        const h0 = headerAt(0), h1 = headerAt(1);
        const stops = { [-1]: null, [1]: null };
        for (const beam of rafters) {
            const [p, q] = beam.top.map((c) => [c[0], c[2]]);
            const d = [q[0] - p[0], q[1] - p[1]], hd = [h1[0] - h0[0], h1[1] - h0[1]];
            const den = hd[0] * d[1] - hd[1] * d[0];
            if (Math.abs(den) < 1e-9) continue; // parallel to the header
            const wv = [p[0] - h0[0], p[1] - h0[1]];
            const a = (wv[0] * d[1] - wv[1] * d[0]) / den;            // along the eave, where the header line crosses it
            const u = (wv[0] * hd[1] - wv[1] * hd[0]) / den;          // along the beam (0..1: on it)
            if (u < -1e-6 || u > 1 + 1e-6) continue;
            const side = Math.sign(a - t);
            if (side === 0) continue;
            if (stops[side] === null || Math.abs(a - t) < Math.abs(stops[side].a - t)) stops[side] = { a, beam, d };
        }
        const ends = [-1, 1].map((side) => (stops[side] ? stops[side].a : t + side * w));
        const clips = [-1, 1].flatMap((side) => {
            const stop = stops[side];
            if (!stop) return [];
            // the stopping beam's side face towards the dormer: its centre line moved by half its width
            const length = Math.hypot(stop.d[0], stop.d[1]);
            let n = [-stop.d[1] / length, stop.d[0] / length];             // horizontal, square to the beam
            const toAxis = [edge.dir[0] * -side, edge.dir[1] * -side];
            if (n[0] * toAxis[0] + n[1] * toAxis[1] < 0) n = [-n[0], -n[1]];  // pointing towards the dormer
            const half = (stop.beam.width ?? BEAM_SIZE.width) / 2;
            const c = stop.beam.top[0];
            // keep the dormer's side: (p - face) . (-n) <= 0
            return [{ point: [c[0] + n[0] * half, 0, c[2] + n[1] * half], normal: [-n[0], 0, -n[1]] }];
        });
        const header = {
            kind: 'header', depth: DORMER_BEAM_SIZE.headerDepth, width, clips,
            top: [P(ends[0], ridgeDistance, h), P(ends[1], ridgeDistance, h)],
            across: in3,
            down: headerDown // square to the main roof, downwards
        };
        return [...valleys, header];
    });
}

// Surface id of a ceiling's dormer walls (fronts and cheeks: a material of their own, bill of quantities)
export const dormerWallsFaceId = (ceilingId) => `${ceilingId}~dormerwalls`;

/*
* The ceiling's dormers (none: []), as BUILT: with `level`, a dormer in hip mode (hipOffset set) gets its
* derived heights (resolveDormer). The stored data stays the user's intent; only withDormers / updateDormer read
* it raw. Without `level`: the stored dormers as they are.
*/
export const roofDormers = (ceiling, level = null) => (ceiling.roof?.dormers ?? []).map((dormer) => (level ? resolveDormer(ceiling, level, dormer) : dormer));

/*
* HIP MODE (Flavio, 25/10): a dormer between two hip beams with its VALLEYS PARALLEL to them, at a clear gap
* `hipOffset` (m, beam side to beam side in plan) set by the user. Its width stays free (the cheeks on the walls:
* the whole opening), so the two heights are derived, and follow any change of width, position or main roof:
* - a valley is parallel to its hip when its plan ratio (inward per meter along) is the hip's r; the valley
*   runs over half the width, so ridgeDistance = sideDistance + r * width / 2;
* - the valley's axis is the hip's axis moved by gap + both half widths towards the dormer: through the cheek
*   point (run from the corner, sideDistance) that gives sideDistance = r * run - axes * sqrt(1 + r^2).
* With a hip on both sides the tighter one rules (the gap is exact there, larger on the other side: equal on a
* rectangle, where both hips are at the same angle). A facet with no oblique side (a gable): unchanged.
*/
export function resolveDormer(ceiling, level, dormer) {
    if (dormer.hipOffset == null) return dormer;
    const facet = facetSlope(ceiling, level, dormer.eave);
    const hips = facetHipRatios(ceiling, level, dormer.eave);
    if (!facet || !hips || facet.k <= 1e-6) return dormer;
    const axes = dormer.hipOffset + (BEAM_SIZE.width + DORMER_BEAM_SIZE.width) / 2;
    const half = dormer.width / 2;
    const sides = [[hips.left, dormer.t - half], [hips.right, facet.edge.length - dormer.t - half]]
        .filter(([r]) => r !== null)
        .map(([r, run]) => ({ r, side: r * run - axes * Math.hypot(1, r) }));
    if (sides.length === 0) return dormer;
    const { r, side } = sides.reduce((a, b) => (b.side < a.side ? b : a));
    return { ...dormer, eaveHeight: facet.base + facet.k * side, ridgeHeight: facet.base + facet.k * (side + r * half) };
}

// True when the dormer's facet has an oblique side (a hip): hip mode applies
export function dormerOnHips(ceiling, level, dormer) {
    const hips = facetHipRatios(ceiling, level, dormer.eave);
    return !!hips && (hips.left !== null || hips.right !== null);
}

/*
* The two SIDES of the facet of eave `eave`, from each eave corner: { left, right }, each the plan ratio r
* (inward / along, along measured from that corner towards the other) of an oblique side, or null for a side
* square to the eave or leaning outward. A side = the steepest ray from its corner to the facet's points.
* ponytail: exact for convex facets (all the generated ones on convex outlines); a concave outline may pick a
* far vertex, then walk the facet's polygon from the corner instead.
*/
function facetHipRatios(ceiling, level, eave) {
    const facet = (roofFacets(ceiling, level) ?? []).find((item) => item.edge === eave);
    if (!facet) return null;
    const edge = inwardEdges(ceiling.points)[eave];
    const local = facet.points.map((p) => {
        const q = [p[0] - edge.p[0], p[2] - edge.p[1]];
        return [q[0] * edge.dir[0] + q[1] * edge.dir[1], q[0] * edge.n[0] + q[1] * edge.n[1]];
    });
    const side = (fromEnd) => {
        const angle = Math.max(...local.filter(([, d]) => d > 1e-6).map(([a, d]) => Math.atan2(d, fromEnd ? edge.length - a : a)));
        return angle < Math.PI / 2 - 1e-3 ? Math.tan(angle) : null;
    };
    return { left: side(false), right: side(true) };
}

// The level with ceiling `ceilingId`'s dormers replaced by fn(dormers)
const withDormers = (level, ceilingId, fn) => ({
    ...level,
    ceilings: (level.ceilings ?? []).map((item) => (item.id === ceilingId ? { ...item, roof: { ...item.roof, dormers: fn(item.roof?.dormers ?? []) } } : item))
});

/*
* The level with a NEW dormer on the facet under plan point `point` (its axis there), or null when the point
* is on no facet or a default dormer does not fit. Defaults: 1.40 m wide, front 0.50 m back from the eave, a
* 1.20 m front wall, a 30 degree roof (all edited afterwards); narrower / lower when the facet is small.
*/
export function addDormer(level, ceilingId, point, id = newDormerId()) {
    const ceiling = (level.ceilings ?? []).find((item) => item.id === ceilingId);
    const facet = ceiling && (roofFacets(ceiling, level) ?? []).find((item) => pointInPolygon(point, item.points.map((p) => [p[0], p[2]])));
    if (!facet) return null;
    const { edge, k, depth, base } = facetSlope(ceiling, level, facet.edge);
    const t = (point[0] - edge.p[0]) * edge.dir[0] + (point[1] - edge.p[1]) * edge.dir[1];
    for (const [width, setback, wall] of [[1.4, 0.5, 1.2], [1, 0.3, 0.8], [0.6, 0.1, 0.4]]) {
        const half = width / 2;
        const eaveHeight = base + k * setback + wall;
        const dormer = {
            id, eave: facet.edge, width, setback, eaveHeight,
            t: Math.min(Math.max(t, half), edge.length - half),
            // a 30 degree dormer roof, but never past the facet (its ridge must meet the roof)
            ridgeHeight: Math.min(eaveHeight + Math.tan(Math.PI / 6) * half, base + k * depth - 0.01)
        };
        if (dormerFits(ceiling, level, dormer)) return withDormers(level, ceilingId, (dormers) => [...dormers, dormer]);
    }
    return null;
}

// The level with dormer `dormerId` of ceiling `ceilingId` merged with `patch`, or null when it would not fit
export function updateDormer(level, ceilingId, dormerId, patch) {
    const ceiling = (level.ceilings ?? []).find((item) => item.id === ceilingId);
    const dormer = ceiling && (ceiling.roof?.dormers ?? []).find((item) => item.id === dormerId); // stored (raw)
    if (!dormer) return null;
    const next = { ...dormer, ...patch };
    return dormerFits(ceiling, level, resolveDormer(ceiling, level, next)) ? withDormers(level, ceilingId, (dormers) => dormers.map((item) => (item.id === dormerId ? next : item))) : null;
}

// The level without dormer `dormerId` of ceiling `ceilingId`
export const removeDormer = (level, ceilingId, dormerId) => withDormers(level, ceilingId, (dormers) => dormers.filter((item) => item.id !== dormerId));

/*
* A dormer dragged in the plan (PlanView2D.jsx): `handle` = 'ridgeBack' (sets the ridge height: the roof's
* height where the back end is), 'front' (the setback), 'cheek0' / 'cheek1' (that cheek only: the other one
* stays, so each can sit on its own wall) or 'move' (along the eave and the setback together, by the pointer's
* displacement from `start`). `to` = the pointer, plan [x, z].
* SNAPS (`snap` = { lines: [[p, q]] (wall faces), radius (m) }): a cheek moved near a wall face parallel to the
* dormer's axis sits on it (for 'move': the cheek closer to a face); the ridge's back end near the MAIN ridge
* (the facet's top) goes to it (same height as the main ridge).
* Returns the level, or null when the result would not fit (the caller keeps the last valid one).
*/
export function dragDormer(level, ceilingId, dormerId, handle, to, start, startDormer, snap = null) {
    const ceiling = (level.ceilings ?? []).find((item) => item.id === ceilingId);
    const facet = ceiling && facetSlope(ceiling, level, startDormer.eave);
    if (!facet) return null;
    const { edge, k, base, depth } = facet;
    const along = (p) => (p[0] - edge.p[0]) * edge.dir[0] + (p[1] - edge.p[1]) * edge.dir[1];
    const inward = (p) => lineDistance(edge, p);
    const radius = snap?.radius ?? 0;
    // the wall faces parallel to the dormer's axis (square to the eave), as positions along the eave
    const wallAlongs = (snap?.lines ?? []).filter(([p, q]) => {
        const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
        return length > 1e-6 && Math.abs(((q[0] - p[0]) * edge.dir[0] + (q[1] - p[1]) * edge.dir[1]) / length) < 0.02;
    }).map(([p]) => along(p));
    // the nearest wall position within the radius, or null
    const nearestWall = (a) => wallAlongs.reduce((best, w) => (Math.abs(w - a) <= radius && (best === null || Math.abs(w - a) < Math.abs(best - a)) ? w : best), null);
    const [left, right] = [startDormer.t - startDormer.width / 2, startDormer.t + startDormer.width / 2];
    let patch;
    if (handle === 'ridgeBack') {
        const d = Math.abs(inward(to) - depth) <= radius ? depth : inward(to); // onto the main ridge
        patch = { ridgeHeight: base + k * d };
    } else if (handle === 'front') patch = { setback: inward(to) };
    else if (handle === 'cheek0' || handle === 'cheek1') {
        const a = nearestWall(along(to)) ?? along(to);
        const [l, r] = handle === 'cheek0' ? [a, right] : [left, a];
        patch = { t: (l + r) / 2, width: Math.abs(r - l) };
    } else {
        const delta = [to[0] - start[0], to[1] - start[1]];
        let dAlong = delta[0] * edge.dir[0] + delta[1] * edge.dir[1];
        const dIn = delta[0] * edge.n[0] + delta[1] * edge.n[1];
        // snap the cheek that lands closer to a wall face
        const snaps = [left + dAlong, right + dAlong].map((a) => { const w = nearestWall(a); return w === null ? null : w - a; }).filter((s) => s !== null);
        if (snaps.length > 0) dAlong += snaps.reduce((best, s) => (Math.abs(s) < Math.abs(best) ? s : best));
        // the front moves with the dormer and so does the roof under it: the heights follow by k x the move
        patch = { t: startDormer.t + dAlong, setback: startDormer.setback + dIn, eaveHeight: startDormer.eaveHeight + k * dIn, ridgeHeight: startDormer.ridgeHeight + k * dIn };
    }
    return updateDormer(level, ceilingId, dormerId, patch);
}

/*
* The level with the hip ridge of ceiling `ceilingId` set to [a, b] (moved / resized in the plan; kept
* parallel to the longest side: b is projected onto the axis through a), or null when not editable or an end
* falls outside the polygon. `ridge` null = back to the default (centered) ridge.
*/
export function setRoofRidge(level, ceilingId, ridge) {
    const ceilings = level.ceilings ?? [];
    const ceiling = ceilings.find((item) => item.id === ceilingId);
    if (!ceiling || !canEditRidge(ceiling)) return null;
    let roof;
    if (ridge == null) {
        const { ridge: _old, ...rest } = ceiling.roof;
        roof = rest;
    } else {
        const axis = ridgeAxis(ceiling);
        const [a, b] = ridge;
        const t = (b[0] - a[0]) * axis[0] + (b[1] - a[1]) * axis[1];
        const aligned = [a, [a[0] + axis[0] * t, a[1] + axis[1] * t]];
        if (!aligned.every((p) => pointInPolygon(p, ceiling.points))) return null;
        roof = { ...ceiling.roof, ridge: aligned };
    }
    return { ...level, ceilings: ceilings.map((item) => (item.id === ceilingId ? { ...item, roof } : item)) };
}

/*
* ROOF TYPES of the ceiling panel, as eaves: 'flat' (none) | 'single' (one eave: edge k) | 'gable' (edge k
* and the opposite one, k + n/2: the other sides are the gables) | 'hip' (every edge). k = the longest edge
* by default; rotateRoof moves it on (another side for a single pitch, the other pair for a gable).
*/
export function roofType(ceiling) {
    const count = roofEaves(ceiling).length;
    return count === 0 ? 'flat' : count === 1 ? 'single' : count === ceiling.points.length ? 'hip' : 'gable';
}
function eavesFor(type, n, k) {
    if (type === 'single') return [k];
    if (type === 'gable') return [k, (k + Math.floor(n / 2)) % n];
    if (type === 'hip') return [...Array(n).keys()];
    return [];
}
// The level with ceiling `ceilingId` turned into `type` (flat drops the roof); the ridge height is kept (a new
// roof starts at a DEFAULT_ROOF_PITCH ridge)
export function setCeilingRoof(level, ceilingId, type) {
    return {
        ...level,
        ceilings: (level.ceilings ?? []).map((ceiling) => {
            if (ceiling.id !== ceilingId) return ceiling;
            const { roof, ...rest } = ceiling;
            if (type === 'flat') return rest;
            const edges = inwardEdges(ceiling.points);
            const longest = edges.reduce((best, edge, i) => (edge.length > edges[best].length + 1e-9 ? i : best), 0);
            const k = roofEaves(ceiling)[0] ?? longest; // keep the current side when switching type
            const eaves = eavesFor(type, ceiling.points.length, k);
            const ridgeHeight = (roof && roofRidgeHeight(ceiling, level))
                ?? ceilingHeight(ceiling, level) + Math.tan((DEFAULT_ROOF_PITCH * Math.PI) / 180) * ridgeDistance(ceiling, eaves);
            return { ...rest, roof: { ridgeHeight, eaves } };
        })
    };
}
// The level with ceiling `ceilingId`'s eaves moved on by one side (single / gable; hip and flat unchanged)
export function rotateRoof(level, ceilingId) {
    return {
        ...level,
        ceilings: (level.ceilings ?? []).map((ceiling) => {
            const type = roofType(ceiling);
            if (ceiling.id !== ceilingId || type === 'flat' || type === 'hip') return ceiling;
            const n = ceiling.points.length;
            return { ...ceiling, roof: { ...ceiling.roof, eaves: eavesFor(type, n, (roofEaves(ceiling)[0] + 1) % n) } };
        })
    };
}
// The level with ceiling `ceilingId`'s ridge height (m above the level's 0; an old stored pitch is dropped),
// or null when flat, not at least MIN_RISE above the eaves, or above MAX_RIDGE_HEIGHT
export function setRoofRidgeHeight(level, ceilingId, ridgeHeight) {
    const ceilings = level.ceilings ?? [];
    const ceiling = ceilings.find((item) => item.id === ceilingId);
    if (!ceiling?.roof || !(ridgeHeight >= ceilingHeight(ceiling, level) + MIN_RISE && ridgeHeight <= MAX_RIDGE_HEIGHT)) return null;
    const { pitch: _old, ...roof } = ceiling.roof;
    return { ...level, ceilings: ceilings.map((item) => (item.id === ceilingId ? { ...item, roof: { ...roof, ridgeHeight } } : item)) };
}

// The level with ceiling `ceilingId` at `height`, or null when out of CEILING_HEIGHT_LIMITS
export function setCeilingHeight(level, ceilingId, height) {
    const { min, max } = CEILING_HEIGHT_LIMITS;
    if (!(height >= min && height <= max)) return null; // also rejects NaN
    const ceilings = level.ceilings ?? [];
    const ceiling = ceilings.find((item) => item.id === ceilingId);
    if (!ceiling) return null;
    // a pitched ceiling: the eaves stay below the ridge, which does not move (an old pitch becomes its ridge)
    const ridgeHeight = roofRidgeHeight(ceiling, level);
    if (ridgeHeight != null && height > ridgeHeight - MIN_RISE) return null;
    const roof = ridgeHeight == null ? {} : { roof: (({ pitch: _old, ...rest }) => ({ ...rest, ridgeHeight }))(ceiling.roof) };
    return { ...level, ceilings: ceilings.map((item) => (item.id === ceilingId ? { ...item, height, ...roof } : item)) };
}

const ROOM_GAP = 0.03;    // meters: free wall ends are run on by this much, closing hairline gaps between walls
const ROOM_GRID = 1e-6;   // meters: arrangement vertices closer than this are one

/*
* The CLEAR AREA around `point`: the smallest region enclosed by the walls' FOOTPRINTS (wallFootprint: mitered
* corners, T joints on faces) that holds it, as a polygon [[x, z], ...] (collinear points dropped), or null.
* Robust to walls that only touch or overlap (traced, merged, drawn up to a face: no shared corner needed):
* every footprint edge is cut where it meets the others (a planar ARRANGEMENT) and the faces of that planar
* graph are walked; the room is the smallest bounded face holding the point. Free wall ends are run on by
* ROOM_GAP so that walls drawn a hair apart still close the room. Openings do not cut footprints: a door
* keeps its room closed.
* ponytail: O(n²) edge intersections (fine for a few hundred walls, run on a click).
*/
export function roomAt(walls, point) {
    const edges = [];
    for (const wall of walls) {
        const f = wallFootprint(wall, walls);
        const { dir } = wallFrame(wall);
        const run = (p, sign, joined) => (joined ? p : add(p, scale(dir, sign * ROOM_GAP)));
        const quad = [run(f.a, -1, f.aJoined), run(f.b, 1, f.bJoined), run(f.bOut, 1, f.bJoined), run(f.aOut, -1, f.aJoined)];
        if (pointInPolygon(point, quad)) return null; // inside a wall
        quad.forEach((p, i) => edges.push([p, quad[(i + 1) % 4]]));
    }
    // cut every edge where the others meet it (crossings, touching ends, collinear overlaps)
    const pieces = [];
    for (const [i, [p, q]] of edges.entries()) {
        const d = sub(q, p);
        const lengthSq = dotp(d, d);
        if (lengthSq < 1e-12) continue;
        const cuts = [0, 1];
        for (const [j, [r, s]] of edges.entries()) {
            if (i === j) continue;
            const e = sub(s, r);
            const den = cross(d, e);
            if (Math.abs(den) > 1e-12) {
                const t = cross(sub(r, p), e) / den, u = cross(sub(r, p), d) / den;
                if (t > 1e-9 && t < 1 - 1e-9 && u > -1e-9 && u < 1 + 1e-9) cuts.push(t);
            } else if (Math.abs(cross(sub(r, p), d)) < 1e-9) {
                // collinear: the other's ends that fall inside this edge
                for (const x of [r, s]) {
                    const t = dotp(sub(x, p), d) / lengthSq;
                    if (t > 1e-9 && t < 1 - 1e-9) cuts.push(t);
                }
            }
        }
        cuts.sort((x, y) => x - y);
        for (let k = 1; k < cuts.length; k++) {
            if (cuts[k] - cuts[k - 1] > 1e-9) pieces.push([add(p, scale(d, cuts[k - 1])), add(p, scale(d, cuts[k]))]);
        }
    }
    // planar graph: merged vertices, each piece once, both directions
    const keyOf = (p) => `${Math.round(p[0] / ROOM_GRID)}|${Math.round(p[1] / ROOM_GRID)}`;
    const vertices = new Map(); // key -> { p, out: [neighbor keys] }
    const seen = new Set();
    for (const [p, q] of pieces) {
        const kp = keyOf(p), kq = keyOf(q);
        if (kp === kq) continue;
        const id = kp < kq ? `${kp}#${kq}` : `${kq}#${kp}`;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const [k, x] of [[kp, p], [kq, q]]) if (!vertices.has(k)) vertices.set(k, { p: x, out: [] });
        vertices.get(kp).out.push(kq);
        vertices.get(kq).out.push(kp);
    }
    // outgoing edges sorted counter-clockwise by angle
    const angle = (from, to) => Math.atan2(vertices.get(to).p[1] - vertices.get(from).p[1], vertices.get(to).p[0] - vertices.get(from).p[0]);
    for (const [k, v] of vertices) v.out.sort((x, y) => angle(k, x) - angle(k, y));
    // face walk: from u -> v, go on along the edge just clockwise of v -> u (the face stays on the left)
    const used = new Set();
    let best = null;
    for (const [start, v0] of vertices) {
        for (const first of v0.out) {
            if (used.has(`${start}>${first}`)) continue;
            const loop = [];
            let u = start, v = first, guard = 0;
            while (!used.has(`${u}>${v}`) && guard++ < 100000) {
                used.add(`${u}>${v}`);
                loop.push(vertices.get(u).p);
                const around = vertices.get(v).out;
                const back = around.indexOf(u);
                const next = around[(back - 1 + around.length) % around.length];
                u = v;
                v = next;
            }
            if (loop.length < 3 || signedArea(loop) <= 1e-9 || !pointInPolygon(point, loop)) continue;
            const area = polygonArea(loop);
            if (best == null || area < best.area) best = { loop, area };
        }
    }
    if (best == null) return null;
    // clean: spikes (dangling edges walked both ways) and collinear points
    const clean = removeSpikes(best.loop);
    return clean.filter((p, i) => {
        const prev = clean[(i - 1 + clean.length) % clean.length], next = clean[(i + 1) % clean.length];
        return Math.abs(cross(sub(p, prev), sub(next, p))) > 1e-9;
    });
}
