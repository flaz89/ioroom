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
// Doors and windows alike: operation 'swing' (hinged leaves) | 'slide' (doors: sliding on a wall face, the
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

/*
* The LEAVES of an opening spanning from..to along its wall's line: [{ from, to, towardsStart }], equal
* widths, in order. towardsStart = the leaf's fixed side is its start-side edge: the hinge of a swing leaf,
* the side a sliding / pocket leaf slides away to. A leaf in the first half goes towards the start, one in
* the second half towards the end (a pair parts in the middle), the middle leaf of an odd count follows
* opening.hinge ('start' default | 'end'): 1 leaf = the classic single hinge choice.
*/
export function openingLeaves(opening, from, to) {
    const count = Math.min(MAX_LEAVES, Math.max(1, Math.round(opening.leaves ?? 1)));
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
* closer than MIN_LINTEL to the wall's top, or overlapping another opening of the wall.
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
    return updateWall(level, wallId, { openings: wall.openings.map((o) => (o.id === openingId ? next : o)) });
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
export function addFloor(level, points, id = newFloorId()) {
    const clean = floorPolygon(points);
    return clean && { ...level, floors: [...level.floors, { id, points: clean }] };
}

// The level with vertex `index` of floor `floorId` moved to `to` (floor tool, vertex drag); null when the
// result is not a valid floor (floorPolygon: e.g. edges crossing). A vertex dropped on a neighbour merges.
export function moveFloorVertex(level, floorId, index, to) {
    const floor = level.floors.find((item) => item.id === floorId);
    const clean = floor && floorPolygon(floor.points.map((p, i) => (i === index ? to : p)));
    return clean && { ...level, floors: level.floors.map((item) => (item.id === floorId ? { ...item, points: clean } : item)) };
}

// The level without floor `floorId`
export const removeFloor = (level, floorId) => ({ ...level, floors: level.floors.filter((floor) => floor.id !== floorId) });

// The floor under `point` (the smallest one, if they overlap), or null
export function floorAt(level, point) {
    const hits = level.floors.filter((floor) => pointInPolygon(point, floor.points));
    return hits.reduce((best, floor) => (best == null || polygonArea(floor.points) < polygonArea(best.points) ? floor : best), null);
}

/*
* FILL A ROOM (floor tool, double click inside a room): the level with a new floor covering the clear area
* around `point` (roomAt: bounded by the walls' footprints). Returns null when the point is not enclosed
* (or is inside a wall), or when a floor already covers it (no double floors in the bill of quantities).
*/
export function fillRoom(level, point, id = newFloorId()) {
    if (level.floors.some((floor) => pointInPolygon(point, floor.points))) return null;
    const room = roomAt(level.walls, point);
    return room && addFloor(level, room, id);
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
