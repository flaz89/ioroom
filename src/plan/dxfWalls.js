/*
* AUTOMATIC WALLS from a DXF underlay (builder, Tappa 4b): the walls of a CAD plan are drawn as PAIRS of
* parallel lines (the two faces), so a wall is found wherever two parallel lines of the chosen layer face
* each other at a wall-like distance. Pure functions, no DOM: drawing-unit segments in, wall candidates out.
*
* wallCandidates(segments, unitMeters, options?) -> [{ a: [x, z], b: [x, z], thickness, openings }]
* - segments: flat [x1, z1, x2, z2, ...] in DRAWING UNITS (dxfUnderlay.js layer segments); unitMeters: meters
*   per drawing unit (underlay.metersPerPixel), used only to turn the thresholds below into drawing units.
* - options.context: [{ name, segments }] the drawing's visible layers (same units), read to tell doors from
*   windows (step 5). Without it every opening is a door.
* - a, b: the wall's CENTER line; thickness: the distance between the faces; openings: [{ from, to, kind }]
*   along the wall (distances from `a`), kind 'door' | 'window'. All in drawing units, like the input (placed
*   on the plan with the underlay's center / rotation / scale).
* Steps:
* 1. Lines are grouped by direction (ANGLE_TOLERANCE, directions 180° apart are the same) and measured in
*    their group's frame: offset across (d) and interval along ([t1, t2]).
* 2. Collinear pieces (same offset within MERGE_GAP) touching or overlapping are merged: a face drawn in
*    several pieces becomes one line; a face interrupted by a door or window stays split (that is a gap).
* 3. Two lines of a group make a wall when they are MIN..MAX_THICKNESS apart, overlap along their direction by
*    at least MIN_OVERLAP and no other line of the group lies between them over that overlap (a third parallel
*    line inside means they are not the two faces of one wall).
* 4. CONTINUITY: pieces of one wall (same center line and thickness within SAME_WALL) interrupted by a gap of at
*    most MAX_OPENING are joined into one wall; the gap becomes an OPENING (the wall above it, the lintel, comes
*    from the plan's openings in 3D). Wider gaps stay separate walls (an open passage). Pillars are kept.
* 5. ENDS: a wall end is carried onto the center line of the wall in front of it (extendEnds): corners and T
*    joints close; a gap of at most MAX_END_GAP between a wall's end and the wall across becomes a door opening.
* 6. JUNCTIONS: where another wall joins a wall, the joined wall's face lines are interrupted: that stretch of a
*    gap is not an opening. A gap holding a joint and an opening side by side (a window right next to a T joint)
*    keeps the rest as the opening, when at least MIN_OPENING wide (withoutJunctions).
* 7. DOOR or WINDOW: a layer named like doors / windows (DOOR_LAYER / WINDOW_LAYER) with lines in the opening
*    decides; else lines parallel to the wall INSIDE its thickness covering at least WINDOW_COVER of the gap
*    (glass, frame) make a window; anything else (a swing arc, a leaf beside it, nothing) is a door.
*    A guess: the review lets the user switch it.
* ponytail: a pair with a line between them is dropped whole (not split around it); walls drawn with inner
*   layers (insulation lines on the same layer) are not found. Pairs are scanned per direction group sorted by
*   offset: fine for thousands of lines; add a spatial index if huge layers are slow.
*/
import { OPENING_DEFAULTS, faceOffsets, newOpeningId, newWallId, wallFootprint, wallFrame } from './planModel.js';

const ANGLE_TOLERANCE = (1 * Math.PI) / 180; // lines this close in direction are parallel
const MERGE_GAP = 0.005;                     // meters: collinear pieces this close are one line
export const MIN_THICKNESS = 0.05;           // meters: thinner = two lines of one detail, not a wall
export const MAX_THICKNESS = 0.6;            // meters: farther = two different walls (a corridor, a room)
const MIN_OVERLAP = 0.2;                     // meters: faces facing each other at least this long
const SAME_WALL = 0.01;                      // meters: center lines / thicknesses this close = one wall
export const MAX_OPENING = 3;                // meters: wider gaps between wall pieces are not openings
const MIN_OPENING = 0.3;                     // meters: narrower leftovers of a gap beside a joint are not openings
const WINDOW_COVER = 0.7;                    // share of an opening covered by in-wall lines = a window
const MAX_END_GAP = 1.6;                     // meters: a wall end this close to another wall is joined to it (door between)
const MIN_JOIN_ANGLE = (10 * Math.PI) / 180; // walls closer than this to parallel never join end-to-side
const DOOR_LAYER = /door|porta|porte/i;
const WINDOW_LAYER = /window|wind|glaz|finestr/i;

export function wallCandidates(segments, unitMeters, options = {}) {
    const minThickness = (options.minThickness ?? MIN_THICKNESS) / unitMeters;
    const maxThickness = (options.maxThickness ?? MAX_THICKNESS) / unitMeters;
    const minOverlap = (options.minOverlap ?? MIN_OVERLAP) / unitMeters;
    const mergeGap = MERGE_GAP / unitMeters;
    const sameWall = SAME_WALL / unitMeters;
    const maxOpening = (options.maxOpening ?? MAX_OPENING) / unitMeters;
    const context = options.context ?? [];

    // 1. lines with their direction angle in [-tolerance, PI - tolerance) (opposite directions folded together)
    const lines = [];
    for (let i = 0; i + 3 < segments.length; i += 4) {
        const [x1, z1, x2, z2] = [segments[i], segments[i + 1], segments[i + 2], segments[i + 3]];
        if (Math.hypot(x2 - x1, z2 - z1) < mergeGap) continue;
        let angle = Math.atan2(z2 - z1, x2 - x1);
        if (angle < -ANGLE_TOLERANCE) angle += Math.PI;
        if (angle >= Math.PI - ANGLE_TOLERANCE) angle -= Math.PI;
        lines.push({ angle, x1, z1, x2, z2 });
    }
    lines.sort((p, q) => p.angle - q.angle);

    // direction groups: angles within 2 x the tolerance of the group's FIRST angle (never chained from line to
    // line: a drawing with many directions, e.g. tessellated arcs, would chain into one group spanning many
    // degrees, and walls measured in its mean frame came out skewed)
    const groups = [];
    for (const line of lines) {
        const group = groups[groups.length - 1];
        if (group && line.angle - group.first <= 2 * ANGLE_TOLERANCE) group.lines.push(line);
        else groups.push({ lines: [line], first: line.angle });
    }

    const walls = [];
    for (const group of groups) {
        // group frame: u along the mean direction, n across it
        const angle = group.lines.reduce((sum, line) => sum + line.angle, 0) / group.lines.length;
        const ux = Math.cos(angle), uz = Math.sin(angle), nx = -uz, nz = ux;
        const measured = group.lines.map(({ x1, z1, x2, z2 }) => {
            const ta = x1 * ux + z1 * uz, tb = x2 * ux + z2 * uz;
            return { d: ((x1 + x2) * nx + (z1 + z2) * nz) / 2, t1: Math.min(ta, tb), t2: Math.max(ta, tb) };
        });
        const merged = mergeCollinear(measured, mergeGap);

        // 3. facing pairs (sorted by offset: the scan stops past the maximum thickness)
        const pieces = []; // { d, thickness, t1, t2 } in the group frame
        for (let i = 0; i < merged.length; i++) {
            const p = merged[i];
            for (let j = i + 1; j < merged.length; j++) {
                const q = merged[j];
                const thickness = q.d - p.d;
                if (thickness > maxThickness) break;
                if (thickness < minThickness) continue;
                const t1 = Math.max(p.t1, q.t1), t2 = Math.min(p.t2, q.t2);
                if (t2 - t1 < minOverlap) continue;
                let blocked = false;
                for (let k = i + 1; k < j && !blocked; k++) {
                    const r = merged[k];
                    blocked = r.d - p.d > mergeGap && q.d - r.d > mergeGap && Math.min(r.t2, t2) - Math.max(r.t1, t1) > mergeGap;
                }
                if (blocked) continue;
                if (t2 - t1 < thickness) continue; // a pillar is found both ways: keep the way it is longer
                pieces.push({ d: (p.d + q.d) / 2, thickness, t1, t2 });
            }
        }

        // 4. pieces of one wall joined across their gaps (openings)
        for (const wall of joinPieces(pieces, sameWall, maxOpening, mergeGap)) {
            const point = (t) => [ux * t + nx * wall.d, uz * t + nz * wall.d];
            walls.push({
                a: point(wall.t1),
                b: point(wall.t2),
                thickness: wall.thickness,
                openings: wall.gaps.map(([g1, g2]) => ({ from: g1 - wall.t1, to: g2 - wall.t1 }))
            });
        }
    }

    // 5. ends run into the walls they meet (corners, T joints, doors at a wall's end); 6. junctions are not
    // openings; 7. each opening's kind
    const tolerance = SAME_WALL / unitMeters;
    const maxEndGap = (options.maxEndGap ?? MAX_END_GAP) / unitMeters;
    const joined = addDoorways(extendEnds(walls, maxEndGap, tolerance, context), maxEndGap, tolerance, context);
    for (const wall of joined) {
        wall.openings = withoutJunctions(joined, wall, wall.openings, MIN_OPENING / unitMeters, tolerance)
            .map((opening) => ({ ...opening, kind: openingKind(context, wall, opening.from, opening.to) }));
    }
    return joined.map(({ a, b, thickness, openings }) => ({ a, b, thickness, openings })); // `ends`: internal
}

// Unit direction and length of a wall { a, b }
function frameOf(wall) {
    const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) || 1e-12; // never 0: no NaN
    return { ux: (wall.b[0] - wall.a[0]) / length, uz: (wall.b[1] - wall.a[1]) / length, length };
}

// A pillar: a wall not even twice as long as it is thick (kept as found: never extended nor joined to)
const isPillar = (wall) => frameOf(wall).length < 2 * wall.thickness;

/*
* EVIDENCE of a doorway: something drawn (any layer) INSIDE the gap, i.e. a segment whose middle lies strictly
* within the wall's thickness and strictly between the gap's ends (from `start` along `dir`, distances from..to):
* a door frame, a leaf, glass. An empty gap is an open passage. The cap lines closing the wall ends lie on the
* gap's ends and the faces of the walls around on its sides: neither counts.
*/
function gapEvidence(context, start, dir, thickness, from, to, tolerance) {
    const nx = -dir[1], nz = dir[0];
    const half = thickness / 2 - tolerance;
    for (const { segments } of context) {
        for (let i = 0; i + 3 < segments.length; i += 4) {
            const mx = (segments[i] + segments[i + 2]) / 2 - start[0], mz = (segments[i + 1] + segments[i + 3]) / 2 - start[1];
            const t = mx * dir[0] + mz * dir[1], d = mx * nx + mz * nz;
            if (t > from + tolerance && t < to - tolerance && Math.abs(d) < half) return true;
        }
    }
    return false;
}

// Where the line from `origin` along `dir` crosses the center line of `other`: { s (along dir), u (along other) }
// or null when (about) parallel
function crossing(origin, dir, other) {
    const o = frameOf(other);
    const denominator = dir[0] * o.uz - dir[1] * o.ux; // cross(dir, other's direction)
    if (Math.abs(denominator) < Math.sin(MIN_JOIN_ANGLE)) return null;
    const wx = other.a[0] - origin[0], wz = other.a[1] - origin[1];
    return { s: (wx * o.uz - wz * o.ux) / denominator, u: (wx * dir[1] - wz * dir[0]) / denominator, sine: Math.abs(denominator), length: o.length };
}

/*
* 5. Each wall END is joined to the first non-parallel wall in front of it, when that wall's near face is at
* most `maxGap` away and the crossing lies on that wall (or just past its ends, by half this wall's thickness:
* two walls of a corner both stop at its inner corner). Walls never run into each other:
* - L CORNER (the other wall ends there too): both ends go to the crossing of the two CENTER lines, the same
*   point for both walls: the plan model (planModel.wallFootprint) miters them there, face by face;
* - T JOINT (the other wall runs on): the end stops on the other wall's NEAR FACE (an end that overshoots into
*   it is trimmed back); the plan model attaches it there (closedLoops: an end within a wall's thickness);
* - face farther (a door between a wall's end and the wall across): the end goes to that face, with an
*   OPENING from the old end to it, only when something is drawn in the gap (gapEvidence): an empty gap is an
*   open passage, the end stays free.
* Computed on the original walls, then applied: the result does not depend on the walls' order.
* Each result wall keeps `ends: { a, b }`: per end, null (free end) or { other, door, corner } (what it reached).
*/
function extendEnds(walls, maxGap, tolerance, context) {
    return walls.map((wall) => {
        if (isPillar(wall)) return { ...wall, ends: { a: null, b: null } };
        const { ux, uz, length } = frameOf(wall);
        let { a, b, openings } = wall;
        let shift = 0; // a moved back: every distance from a grows by this (shrinks when trimmed)
        const ends = { a: null, b: null };
        for (const [key, end, dir] of [['b', wall.b, [ux, uz]], ['a', wall.a, [-ux, -uz]]]) {
            let best = null;
            for (const other of walls) {
                if (other === wall || isPillar(other)) continue;
                const hit = crossing(end, dir, other);
                if (hit == null) continue;
                const halfDepth = other.thickness / 2 / hit.sine; // center line to face, along this wall
                const face = hit.s - halfDepth; // distance to the near face (negative: the end is inside it)
                const margin = wall.thickness / 2 / hit.sine + tolerance;
                if (face < -2 * halfDepth - tolerance || face > maxGap || hit.u < -margin || hit.u > hit.length + margin) continue;
                if (best == null || face < best.face) best = { ...hit, face, other };
            }
            if (best == null) continue;
            const door = best.face > tolerance;
            if (door && !gapEvidence(context, end, dir, wall.thickness, 0, best.face, tolerance)) continue; // open passage
            const center = [end[0] + dir[0] * best.s, end[1] + dir[1] * best.s];
            const corner = !door && isEndAt(best.other, center, wall.thickness / best.sine, tolerance);
            const step = corner ? best.s : best.face; // corner: center lines meet; else: up to the near face
            const reach = [end[0] + dir[0] * step, end[1] + dir[1] * step];
            ends[key] = { other: best.other, door, corner };
            if (key === 'b') {
                b = reach;
                if (door) openings = [...openings, { from: length + shift, to: length + shift + best.face }];
            } else {
                a = reach;
                shift = step;
                openings = openings.map((opening) => ({ from: opening.from + shift, to: opening.to + shift }));
                if (door) openings = [{ from: 0, to: best.face }, ...openings];
            }
        }
        return { ...wall, a, b, openings, ends };
    });
}

/*
* 5b. DOORWAYS where no wall piece is drawn on either side, only the walls around the door:
* - past an L CORNER: a wall that ends at a corner (the other wall ends there too) and, straight ahead past the
*   corner, the first wall's face is at most `maxGap` away: the door continues the wall (red B in the test plan);
* - between two FREE ENDS of parallel walls that overlap along their direction by about one thickness and face
*   each other across at most `maxGap`: the door is a short wall across, through that overlap (red A).
* Each adds a wall { a, b, thickness, openings: [the door, its whole length] } from FACE to face (the walls
* around keep their thickness whole).
* Both only with something drawn in the gap (gapEvidence: a door frame, a leaf), never for pillars.
*/
function addDoorways(walls, maxGap, tolerance, context) {
    const added = [];
    const doorway = (start, dir, thickness, from, to, length) => added.push({
        a: start,
        b: [start[0] + dir[0] * length, start[1] + dir[1] * length],
        thickness,
        openings: [{ from, to }],
        ends: { a: null, b: null }
    });
    for (const wall of walls) {
        if (isPillar(wall)) continue;
        const { ux, uz } = frameOf(wall);
        for (const [key, dir] of [['b', [ux, uz]], ['a', [-ux, -uz]]]) {
            const joint = wall.ends[key];
            if (joint == null || !joint.corner) continue;
            // past the corner (this end is on the corner's center lines): from the corner wall's far face, the
            // first wall straight ahead
            const corner = crossing(wall[key], dir, joint.other);
            const startGap = corner ? joint.other.thickness / 2 / corner.sine : 0;
            let best = null;
            for (const other of walls) {
                if (other === wall || other === joint.other || isPillar(other)) continue;
                const hit = crossing(wall[key], dir, other);
                if (hit == null) continue;
                const face = hit.s - other.thickness / 2 / hit.sine - startGap;
                const margin = wall.thickness / 2 / hit.sine + tolerance;
                if (face <= tolerance || face > maxGap || hit.u < -margin || hit.u > hit.length + margin) continue;
                if (best == null || face < best.face) best = { ...hit, face };
            }
            if (best && gapEvidence(context, wall[key], dir, wall.thickness, startGap, startGap + best.face, tolerance)) {
                // from the corner wall's far face (the corner stays an L: nothing runs into it) to the face ahead;
                // the plan model attaches that end to the corner (closedLoops: an end within a wall's end)
                const start = [wall[key][0] + dir[0] * startGap, wall[key][1] + dir[1] * startGap];
                doorway(start, dir, wall.thickness, 0, best.face, best.face);
            }
        }
    }
    // free ends of parallel walls, overlapping by about a thickness, facing each other
    for (let i = 0; i < walls.length; i++) {
        for (let j = i + 1; j < walls.length; j++) {
            const p = walls[i], q = walls[j];
            if (isPillar(p) || isPillar(q) || Math.abs(p.thickness - q.thickness) > tolerance) continue;
            const { ux, uz } = frameOf(p);
            const nx = -uz, nz = ux;
            const qf = frameOf(q);
            if (Math.abs(ux * qf.uz - uz * qf.ux) > Math.sin(ANGLE_TOLERANCE)) continue; // not parallel
            const t = (point) => point[0] * ux + point[1] * uz, d = (point) => point[0] * nx + point[1] * nz;
            const gap = Math.abs(d(q.a) - d(p.a)) - p.thickness;
            if (gap <= tolerance || gap > maxGap) continue;
            const [p1, p2] = [t(p.a), t(p.b)], [q1, q2] = [t(q.a), t(q.b)].sort((x, y) => x - y);
            const o1 = Math.max(p1, q1), o2 = Math.min(p2, q2);
            if (o2 - o1 < 0.5 * p.thickness || o2 - o1 > 1.5 * p.thickness) continue;
            // the overlap must sit at a FREE end of each wall
            const pEnd = Math.abs(o1 - p1) <= tolerance ? 'a' : Math.abs(o2 - p2) <= tolerance ? 'b' : null;
            const qFree = q.ends.a == null && Math.abs(t(q.a) - (t(q.a) < t(q.b) ? o1 : o2)) <= tolerance
                || q.ends.b == null && Math.abs(t(q.b) - (t(q.b) < t(q.a) ? o1 : o2)) <= tolerance;
            if (pEnd == null || p.ends[pEnd] != null || !qFree) continue;
            const across = Math.sign(d(q.a) - d(p.a));
            const mid = (o1 + o2) / 2, face = d(p.a) + (across * p.thickness) / 2; // p's face towards q
            const start = [ux * mid + nx * face, uz * mid + nz * face];
            const dir = [nx * across, nz * across];
            if (!gapEvidence(context, start, dir, p.thickness, 0, gap, tolerance)) continue;
            doorway(start, dir, p.thickness, 0, gap, gap);
        }
    }
    return [...walls, ...added];
}

// Whether `wall` ends (either end) within `reach` + tolerance of `point`: the two walls form an L corner there
function isEndAt(wall, point, reach, tolerance) {
    return [wall.a, wall.b].some((end) => Math.hypot(end[0] - point[0], end[1] - point[1]) <= reach + tolerance);
}

// 6. The openings of `wall` minus the stretches where other walls join it (their thickness across this wall's
// center line, after 5): what is left of each opening, kept when at least `minWidth` wide
function withoutJunctions(walls, wall, openings, minWidth, tolerance) {
    const { ux, uz } = frameOf(wall);
    const joints = []; // [from, to] along this wall covered by a joining wall
    for (const other of walls) {
        if (other === wall) continue;
        const hit = crossing(wall.a, [ux, uz], other);
        // a joining wall stops on this wall's face: its center line reaches this one's half a thickness further
        const margin = wall.thickness / 2 / (hit?.sine ?? 1) + tolerance;
        if (hit == null || hit.u < -margin || hit.u > hit.length + margin) continue;
        const half = other.thickness / 2 / hit.sine;
        joints.push([hit.s - half, hit.s + half]);
    }
    let result = openings;
    for (const [j1, j2] of joints) {
        result = result.flatMap((opening) => {
            if (j2 <= opening.from || j1 >= opening.to) return [opening];
            return [{ from: opening.from, to: j1 }, { from: j2, to: opening.to }].filter((part) => part.to - part.from >= minWidth);
        });
    }
    return result;
}

// 4. Pieces on one center line with one thickness (within `same`), in order along it: a gap up to `maxGap`
// becomes an opening of one wall { d, thickness, t1, t2, gaps: [[g1, g2]] }; touching pieces just merge.
function joinPieces(pieces, same, maxGap, mergeGap) {
    pieces.sort((p, q) => p.d - q.d);
    const lines = []; // runs of pieces on (about) the same center line
    for (const piece of pieces) {
        const line = lines[lines.length - 1];
        if (line && piece.d - line[line.length - 1].d <= same) line.push(piece);
        else lines.push([piece]);
    }
    const walls = [];
    for (const line of lines) {
        line.sort((p, q) => p.t1 - q.t1);
        let wall = null;
        for (const piece of line) {
            const gap = wall ? piece.t1 - wall.t2 : Infinity;
            if (wall && Math.abs(piece.thickness - wall.thickness) <= same && gap <= maxGap) {
                if (gap > mergeGap) wall.gaps.push([wall.t2, piece.t1]);
                wall.t2 = Math.max(wall.t2, piece.t2);
            } else {
                if (wall) walls.push(wall);
                wall = { ...piece, gaps: [] };
            }
        }
        walls.push(wall);
    }
    return walls;
}

// 7. 'door' | 'window' for the opening [from, to] (distances from wall.a), from the drawing's visible layers
function openingKind(context, wall, from, to) {
    const { ux, uz } = frameOf(wall);
    const nx = -uz, nz = ux;
    const base = wall.a[0] * ux + wall.a[1] * uz, d = wall.a[0] * nx + wall.a[1] * nz;
    const g1 = base + from, g2 = base + to; // the opening along the wall's direction
    const half = wall.thickness / 2;
    const reach = half + (g2 - g1); // a door leaf or swing is drawn beside the wall, up to its width away
    const covered = []; // [t1, t2] of the lines parallel to the wall inside its thickness, within the gap
    let byLayer = null;
    for (const { name, segments } of context) {
        const hint = DOOR_LAYER.test(name) ? 'door' : WINDOW_LAYER.test(name) ? 'window' : null;
        for (let i = 0; i + 3 < segments.length; i += 4) {
            const ta = segments[i] * ux + segments[i + 1] * uz, tb = segments[i + 2] * ux + segments[i + 3] * uz;
            const da = segments[i] * nx + segments[i + 1] * nz - d, db = segments[i + 2] * nx + segments[i + 3] * nz - d;
            const tm = (ta + tb) / 2, dm = (da + db) / 2;
            if (tm < g1 || tm > g2) continue;
            if (hint && Math.abs(dm) <= reach) byLayer ??= hint;
            const parallel = Math.abs(da - db) <= Math.abs(tb - ta) * Math.tan(ANGLE_TOLERANCE);
            if (parallel && Math.abs(da) < half && Math.abs(db) < half) covered.push([Math.max(Math.min(ta, tb), g1), Math.min(Math.max(ta, tb), g2)]);
        }
    }
    if (byLayer) return byLayer;
    covered.sort((p, q) => p[0] - q[0]);
    let length = 0, end = g1;
    for (const [t1, t2] of covered) {
        if (t2 > end) { length += t2 - Math.max(t1, end); end = t2; }
    }
    return length >= WINDOW_COVER * (g2 - g1) ? 'window' : 'door';
}

// 2. Collinear pieces (offsets within `gap`) whose intervals touch or overlap -> one line; sorted by offset
function mergeCollinear(measured, gap) {
    measured.sort((p, q) => p.d - q.d);
    const result = [];
    let start = 0;
    for (let i = 1; i <= measured.length; i++) {
        if (i < measured.length && measured[i].d - measured[i - 1].d <= gap) continue;
        // measured[start..i) share one offset: merge their intervals
        const run = measured.slice(start, i).sort((p, q) => p.t1 - q.t1);
        const d = run.reduce((sum, line) => sum + line.d, 0) / run.length;
        let current = { d, t1: run[0].t1, t2: run[0].t2 };
        for (const line of run.slice(1)) {
            if (line.t1 <= current.t2 + gap) current.t2 = Math.max(current.t2, line.t2);
            else { result.push(current); current = { d, t1: line.t1, t2: line.t2 }; }
        }
        result.push(current);
        start = i;
    }
    return result.sort((p, q) => p.d - q.d);
}

/*
* The detected walls (wallCandidates, drawing units) as PLAN walls (planModel.js), placed like the underlay
* drawing (its center, rotation, meters per unit): { id, a, b, thickness, align: 'center', openings } in plan
* meters. align 'center': the detected line is the wall's axis. Openings get their type's default height and
* sill (OPENING_DEFAULTS); width and position come from the drawing. Ids from `makeId` / newOpeningId (a
* preview can pass stable ones).
*/
export function placeDetectedWalls(walls, underlay, makeId = newWallId) {
    const k = underlay.metersPerPixel;
    const c = Math.cos(underlay.rotation) * k, s = Math.sin(underlay.rotation) * k;
    const [cx, cz] = underlay.center;
    // same placement as the drawing (planView.underlayTargets): positive rotation = clockwise on screen
    const place = ([x, z]) => [cx + x * c - z * s, cz + x * s + z * c];
    return walls.map((wall, index) => ({
        id: makeId(index),
        a: place(wall.a),
        b: place(wall.b),
        thickness: wall.thickness * k,
        align: 'center',
        openings: wall.openings.map((opening) => ({
            id: newOpeningId(),
            type: opening.kind,
            offset: ((opening.from + opening.to) / 2) * k,
            width: (opening.to - opening.from) * k,
            height: OPENING_DEFAULTS[opening.kind].height,
            sill: OPENING_DEFAULTS[opening.kind].sill
        }))
    }));
}

/*
* Preview shapes of placed walls (placeDetectedWalls) exactly as the plan model will build them: each wall's
* footprint (planModel.wallFootprint: corners mitered, T joints butting on faces) and its openings' rectangles
* across the thickness. [{ wall: [[x, z] x 4], openings: [{ type, points: [[x, z] x 4] }] }]
*/
export function detectedWallShapes(planWalls) {
    return planWalls.map((wall) => {
        const footprint = wallFootprint(wall, planWalls);
        const { dir, normal } = wallFrame(wall);
        const { inner, outer } = faceOffsets(wall);
        const at = (t, offset) => [wall.a[0] + dir[0] * t + normal[0] * offset, wall.a[1] + dir[1] * t + normal[1] * offset];
        return {
            wall: [footprint.a, footprint.b, footprint.bOut, footprint.aOut],
            openings: wall.openings.map((opening) => {
                const from = opening.offset - opening.width / 2, to = opening.offset + opening.width / 2;
                return { type: opening.type, points: [at(from, inner), at(to, inner), at(to, outer), at(from, outer)] };
            })
        };
    });
}
