/*
* ASSISTED WALL TRACING on a DXF underlay (builder, "Trace walls" tool): the user points at one FACE of a
* wall in the drawing, the algorithm measures the wall there. Works only near the indicated point, where
* the drawing is reliable (the automatic detection, dxfWalls.js, has to guess over the whole drawing).
* Pure functions, no DOM; everything in PLAN METERS (the underlay's segments already placed on the plan:
* planView.underlayTargets).
*
* traceWall(point, segments, radius) -> { a, b, thickness, face } | null
* - point: [x, z] under the pointer; segments: [[[x, z], [x, z]]] the drawing's visible lines; radius: meters
*   within which a line counts as pointed at.
* - a, b: the wall's CENTER line (the plan adds it with align 'center', so both faces fall exactly on the
*   drawing's lines); thickness: the distance between the faces; face: [[x, z], [x, z]] the pointed face as
*   traced (for the preview).
* Steps:
* 1. The line nearest to `point` (within radius) gives the direction u and the face's offset.
* 2. FACE: the parallel lines (ANGLE_TOLERANCE) on that same offset (MERGE_GAP) are merged where they touch
*    or nearly (BRIDGE_GAP: frame details break faces for a few cm); the face is the merged stretch holding
*    the pointer: one click = the whole stretch up to the first real interruption (a door, a corner, the end).
* 3. OTHER FACE: the nearest parallel line MIN_THICKNESS..MAX_THICKNESS away, on either side, whose merged
*    stretch also runs past the pointer; within the pointed face's stretch its breaks up to T_JOINT_GAP are
*    bridged (a wall joining from that side, a T, interrupts only that face).
* 4. WALL: where the two faces run side by side (their stretches' overlap), center line halfway between.
* 5. JAMBS: a door / window frame drawn at the wall's end runs the faces on for a few cm past the masonry; a
*    line ACROSS the whole wall (a jamb) within FRAME_DEPTH of an end is where the wall really stops (the
*    innermost one: the frame's own lines come first): the frame belongs to the opening, not to the wall.
*
* joinTracedWall(level, trace, id?) -> level | null: the traced wall added to the plan (center aligned, its
* thickness), its ends JOINED to the walls they reach (see the function). null when the same wall is
* already in the plan (traced twice) or the result is too short.
* ponytail: the nearest parallel line wins; a wall drawn with inner lines (insulation, plaster) on the same
*   layer gives a thinner wall; hide those layers. Linear scans per call: fine up to ~100k lines.
*/
import { MAX_THICKNESS, MIN_THICKNESS } from './dxfWalls.js';
import { MIN_WALL_LENGTH, faceOffsets, moveVertex, newWallId, wallFootprint, wallFrame } from './planModel.js';

const ANGLE_TOLERANCE = Math.sin((1 * Math.PI) / 180); // |sin| of the angle between parallel lines
const MERGE_GAP = 0.005;   // meters: lines this close across are on one face
const BRIDGE_GAP = 0.2;    // meters: pieces of one face this close along are one face (frame details and joints
                           // break a face for a few cm; openings are at least MIN_OPENING_SIZE = 30 cm)
export const MIN_TRACE_LENGTH = 0.05; // meters: a shorter side-by-side stretch is no wall
const T_JOINT_GAP = MAX_THICKNESS + 0.05; // meters: a break of the other face this long under a continuous face = a T
const FRAME_DEPTH = 0.15;  // meters: a jamb line this close to a wall's end cuts the frame off the wall
const JAMB_SIN = Math.sin((10 * Math.PI) / 180); // a jamb runs within this of the faces' normal
const JAMB_SPAN = 0.8;     // share of the wall's thickness a jamb line covers

const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const cross = (p, q) => p[0] * q[1] - p[1] * q[0];

function nearestOnSegment(p, a, b) {
    const d = sub(b, a);
    const lengthSq = dot(d, d);
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), d) / lengthSq)) : 0;
    return [a[0] + d[0] * t, a[1] + d[1] * t];
}

// The merged stretch [t1, t2] of `intervals` (along u, pieces up to `bridge` apart joined) holding `t`
// (within MERGE_GAP), or null
function stretchAt(intervals, t, bridge = BRIDGE_GAP) {
    const sorted = [...intervals].sort((p, q) => p[0] - q[0]);
    let current = null;
    for (const [t1, t2] of sorted) {
        if (current && t1 <= current[1] + bridge) current[1] = Math.max(current[1], t2);
        else {
            if (current && current[0] - MERGE_GAP <= t && t <= current[1] + MERGE_GAP) return current;
            current = [t1, t2];
        }
    }
    return current && current[0] - MERGE_GAP <= t && t <= current[1] + MERGE_GAP ? current : null;
}

export function traceWall(point, segments, radius) {
    // 1. the pointed line
    let picked = null, best = radius;
    for (const segment of segments) {
        const near = nearestOnSegment(point, segment[0], segment[1]);
        const distance = Math.hypot(near[0] - point[0], near[1] - point[1]);
        if (distance <= best && Math.hypot(...sub(segment[1], segment[0])) > 1e-9) { picked = segment; best = distance; }
    }
    if (picked == null) return null;
    const d = sub(picked[1], picked[0]);
    const length = Math.hypot(d[0], d[1]);
    const u = [d[0] / length, d[1] / length];
    const n = [-u[1], u[0]];
    const origin = picked[0];
    const tc = dot(sub(point, origin), u); // the pointer along the face

    // parallel lines in the face's frame: offset across, interval along; grouped by offset (MERGE_GAP)
    const groups = []; // [{ offset, intervals }]
    for (const [p, q] of segments) {
        const e = sub(q, p);
        const len = Math.hypot(e[0], e[1]);
        if (len < 1e-9 || Math.abs(cross(u, e)) / len > ANGLE_TOLERANCE) continue;
        const offset = (dot(sub(p, origin), n) + dot(sub(q, origin), n)) / 2;
        const tp = dot(sub(p, origin), u), tq = dot(sub(q, origin), u);
        const group = groups.find((g) => Math.abs(g.offset - offset) <= MERGE_GAP);
        if (group) group.intervals.push([Math.min(tp, tq), Math.max(tp, tq)]);
        else groups.push({ offset, intervals: [[Math.min(tp, tq), Math.max(tp, tq)]] });
    }

    // 2. the face: the pointed offset's stretch under the pointer
    const faceGroup = groups.find((g) => Math.abs(g.offset) <= MERGE_GAP);
    const face = stretchAt(faceGroup.intervals, tc);
    if (face == null) return null;

    // 3. the other face: nearest offset at a wall-like distance whose stretch runs past the pointer. Along the
    // (continuous) pointed face, its breaks up to T_JOINT_GAP are bridged: a wall joining from that side (a T)
    // breaks only that face, for its own thickness
    let other = null;
    for (const group of groups) {
        const gap = Math.abs(group.offset);
        if (gap < MIN_THICKNESS || gap > MAX_THICKNESS || (other && gap >= Math.abs(other.offset))) continue;
        const clipped = group.intervals.map(([t1, t2]) => [Math.max(t1, face[0]), Math.min(t2, face[1])]).filter(([t1, t2]) => t2 > t1);
        const stretch = stretchAt(clipped, tc, T_JOINT_GAP);
        if (stretch) other = { offset: group.offset, stretch };
    }
    if (other == null) return null;

    // 4. the wall: where both faces run side by side, center line halfway between them
    let t1 = Math.max(face[0], other.stretch[0]), t2 = Math.min(face[1], other.stretch[1]);
    // 5. jambs near the ends: lines across the whole thickness, within FRAME_DEPTH inside each end
    const [low, high] = [Math.min(0, other.offset), Math.max(0, other.offset)];
    const thickness = high - low;
    let cut1 = t1, cut2 = t2;
    for (const [p, q] of segments) {
        const e = sub(q, p);
        const len = Math.hypot(e[0], e[1]);
        if (len < 1e-9 || Math.abs(dot(e, u)) / len > JAMB_SIN) continue;
        const [n1, n2] = [dot(sub(p, origin), n), dot(sub(q, origin), n)].sort((x, y) => x - y);
        if (Math.min(n2, high) - Math.max(n1, low) < JAMB_SPAN * thickness) continue;
        const t = (dot(sub(p, origin), u) + dot(sub(q, origin), u)) / 2;
        if (t > t1 + MERGE_GAP && t <= t1 + FRAME_DEPTH) cut1 = Math.max(cut1, t);
        if (t < t2 - MERGE_GAP && t >= t2 - FRAME_DEPTH) cut2 = Math.min(cut2, t);
    }
    if (cut2 - cut1 >= MIN_TRACE_LENGTH) [t1, t2] = [cut1, cut2];
    if (t2 - t1 < MIN_TRACE_LENGTH) return null;
    const middle = other.offset / 2;
    const at = (t, offset) => [origin[0] + u[0] * t + n[0] * offset, origin[1] + u[1] * t + n[1] * offset];
    return { a: at(t1, middle), b: at(t2, middle), thickness: Math.abs(other.offset), face: [at(face[0], 0), at(face[1], 0)] };
}

const MIN_JOIN_SIN = Math.sin((10 * Math.PI) / 180); // walls closer than this to parallel never join
const SAME_AXIS = 0.02;                              // meters: an existing wall this close along the trace = traced already
const JOIN_EPSILON = 1e-6;

// The axis (center line) of a plan wall, whatever its alignment: its drawn line moved halfway between the faces
export function axisOf(wall) {
    const { dir, normal, length } = wallFrame(wall);
    const { inner, outer } = faceOffsets(wall);
    const shift = (inner + outer) / 2;
    const a = [wall.a[0] + normal[0] * shift, wall.a[1] + normal[1] * shift];
    return { a, dir, normal, length };
}

/*
* JOINS of a traced wall, at each end (trace ends: centered on the faces' overlap, so they stop short of the
* corner or at the face of the wall they meet):
* - the end is carried to where the trace's axis crosses the DRAWN LINE of another wall (not near-parallel:
*   MIN_JOIN_SIN), when that crossing is within the other wall's thickness of the end and within the trace's
*   thickness of the other wall's extent (the nearest crossing wins);
* - L CORNER: if the crossing lies within the trace's thickness of one of that wall's ends, that corner moves
*   onto the crossing too (planModel.moveVertex: the walls joined there follow), so both walls share it;
* - T JOINT: otherwise the end stays on that wall's line (the plan stops it at its face: wallFootprint).
*/
export function joinTracedWall(level, trace, id = newWallId()) {
    const d = [trace.b[0] - trace.a[0], trace.b[1] - trace.a[1]];
    const length = Math.hypot(d[0], d[1]);
    if (length < MIN_WALL_LENGTH) return null;
    const u = [d[0] / length, d[1] / length];
    // traced already: an existing wall on the same axis covering the trace's middle
    const middle = [(trace.a[0] + trace.b[0]) / 2, (trace.a[1] + trace.b[1]) / 2];
    const twin = level.walls.some((wall) => {
        const axis = axisOf(wall);
        if (Math.abs(cross(axis.dir, u)) > ANGLE_TOLERANCE) return false;
        const rel = sub(middle, axis.a);
        const along = dot(rel, axis.dir);
        return Math.abs(dot(rel, axis.normal)) <= SAME_AXIS && along >= 0 && along <= axis.length;
    });
    if (twin) return null;

    let next = level;
    const ends = [trace.a, trace.b].map((end) => [end[0], end[1]]);
    for (const [index, end] of ends.entries()) {
        let best = null;
        for (const wall of next.walls) {
            const { dir, length: wallLength } = wallFrame(wall);
            const den = cross(u, dir);
            if (Math.abs(den) < MIN_JOIN_SIN) continue;
            // trace axis: end + s·u; wall's drawn line: wall.a + t·dir
            const t = cross(sub(end, wall.a), u) / -den; // end - wall.a = t·dir - s·u, crossed with u
            const crossing = [wall.a[0] + dir[0] * t, wall.a[1] + dir[1] * t];
            const reach = Math.hypot(crossing[0] - end[0], crossing[1] - end[1]);
            if (reach > wall.thickness + JOIN_EPSILON) continue;
            if (t < -trace.thickness - JOIN_EPSILON || t > wallLength + trace.thickness + JOIN_EPSILON) continue;
            if (best == null || reach < best.reach) best = { reach, crossing, wall, t, wallLength };
        }
        if (best == null) continue;
        ends[index] = best.crossing;
        // L corner: the met wall's nearby end moves onto the crossing, when that wall is alone at that corner
        // (with others there, e.g. a wall running on straight, moving it would turn them: the corner stays)
        const corner = best.t <= trace.thickness ? best.wall.a : best.wallLength - best.t <= trace.thickness ? best.wall.b : null;
        if (corner && aloneAt(next, corner)) next = moveVertex(next, corner, best.crossing) ?? next;
    }
    if (Math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]) < MIN_WALL_LENGTH) return null;
    const result = { ...next, walls: [...next.walls, { id, a: ends[0], b: ends[1], thickness: trace.thickness, align: 'center' }] };
    return hasSoundFaces(result) ? result : null;
}

// True when only one wall of the level has an end at `point`
export function aloneAt(level, point) {
    const at = (p) => Math.hypot(p[0] - point[0], p[1] - point[1]) < JOIN_EPSILON;
    return level.walls.filter((wall) => at(wall.a) || at(wall.b)).length === 1;
}

// True when every wall of the level keeps both faces at least MIN_WALL_LENGTH long after its joins: a
// traced piece shorter than the walls it meets (a pillar's section, a stub between two corners) would
// collapse or turn its faces inside out
// ponytail: checks every wall (n² footprints) on each preview; restrict to the walls near the trace if plans get big
function hasSoundFaces(level) {
    return level.walls.every((wall) => {
        const { dir } = wallFrame(wall);
        const { a, b, aOut, bOut } = wallFootprint(wall, level.walls);
        return dot(sub(b, a), dir) >= MIN_WALL_LENGTH && dot(sub(bOut, aOut), dir) >= MIN_WALL_LENGTH;
    });
}
