/*
* DOOR / WINDOW TOOL (builder, assisted): one click puts an opening where the drawing shows one, on the
* plan's walls (traced, drawn by hand or detected: the tool works on any wall). Pure functions, plan meters.
*
* placeOpening(level, point, type, segments, radius, ids?) -> { level, wallId, openingId, removedWallId } | null
* - point: [x, z] clicked; type: 'door' | 'window'; segments: [[[x, z], [x, z]]] the drawing's visible lines
*   (planView.underlayTargets; [] without a drawing); radius: meters around the point that still count.
* - ids: { opening } stable ids for a preview (default: new ones).
* Two cases:
* A. ON A WALL (the point within the wall's thickness, + radius): the drawing's JAMBS around the point are
*    measured: lines across the wall (within JAMB_ANGLE of its normal) spanning at least JAMB_SPAN of its
*    thickness inside it, not at its ends; the nearest one on each side bound the opening (a window whose
*    glass / frame lines run on along the faces made the trace a full wall: this cuts it). Short frame ticks
*    inside the opening do not span the wall and are skipped.
* B. IN A GAP between two walls on the same axis (parallel, axes within SAME_AXIS, thickness within
*    SAME_AXIS): the two become ONE wall (the first keeps its id, side, height and openings; the second's
*    openings move onto it, same place in the world) and the gap becomes the opening (a door whose faces
*    stop at the jambs split the trace in two). removedWallId: the second wall (its face materials go).
*    A gap narrower than MIN_OPENING_SIZE (a frame detail that broke the trace) just joins the walls, with no
*    opening (openingId null).
* C. IN A GAP between a wall's END and ANOTHER WALL across its axis (a door right after a corner, or facing
*    a partition): the wall runs on to that wall (its end on that wall's drawn line; next to that wall's end
*    it is an L corner and that end moves there too, as joinTracedWall) and the gap, from the old end to the
*    near face, becomes the opening. Tried when B finds nothing; not through a wall that lies across the way
*    between the end and the point (a niche's return).
* B and C: the opening is narrowed to the drawing's JAMBS inside the gap when there are (as A): the bits of
* masonry beside a door frame that were not traced become wall.
* The opening gets its type's default height and sill (OPENING_DEFAULTS); null when nothing is found, the
* width is above MAX_OPENING, or it would overlap another opening (updateOpening).
* ponytail: the nearest jamb wins; a window drawn with full-depth mullions gets cut at the first mullion
*   (two clicks on the jambs would be the fallback, not done yet).
*/
import { MAX_OPENING } from './dxfWalls.js';
import { MIN_OPENING_SIZE, OPENING_DEFAULTS, faceOffsets, moveVertex, newOpeningId, updateOpening, updateWall, wallFrame } from './planModel.js';
import { aloneAt, axisOf } from './traceWall.js';

const JAMB_ANGLE = Math.sin((10 * Math.PI) / 180); // a jamb's direction this close to the wall's normal
const JAMB_SPAN = 0.8;    // share of the wall's thickness a jamb line covers inside the wall
const END_MARGIN = 0.01;  // meters: lines this close to a wall's end are its end caps, not jambs
const SAME_AXIS = 0.02;   // meters: walls this close (axes, thickness) are one wall broken by a gap
const JAMB_SLACK = 0.02;  // meters: jambs this far past a gap's ends still belong to it

const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const cross = (p, q) => p[0] * q[1] - p[1] * q[0];

// Where `point` is in a wall's axis frame: along (from the axis start) and across (from the axis)
function frameOf(wall, point) {
    const axis = axisOf(wall);
    const rel = sub(point, axis.a);
    return { axis, along: dot(rel, axis.dir), across: dot(rel, axis.normal) };
}

// The level with a new opening (type defaults) at `offset` along wall `wallId`, `width` wide; null if invalid
function withOpening(level, wallId, type, offset, width, id) {
    if (width < MIN_OPENING_SIZE - 1e-9 || width > MAX_OPENING) return null;
    const wall = level.walls.find((item) => item.id === wallId);
    const opening = { id, type, offset, ...OPENING_DEFAULTS[type], width };
    const next = updateWall(level, wallId, { openings: [...(wall.openings ?? []), opening] });
    return updateOpening(next, wallId, id, {}) && next; // validated like an edit: inside the wall, no overlap
}

// The drawing's jambs around `along` on `wall` (lines across it, see A): { from, to } along its axis, or null
// Positions (along the wall's axis) of the drawing's JAMB lines: across the wall within JAMB_ANGLE of its
// normal, spanning at least JAMB_SPAN of its thickness inside it, not at its ends
function jambLines(wall, segments) {
    const axis = axisOf(wall);
    const half = wall.thickness / 2;
    const found = [];
    for (const [p, q] of segments) {
        const e = sub(q, p);
        const length = Math.hypot(e[0], e[1]);
        if (length < 1e-9 || Math.abs(dot(e, axis.dir)) / length > JAMB_ANGLE) continue;
        const [n1, n2] = [p, q].map((r) => dot(sub(r, axis.a), axis.normal)).sort((x, y) => x - y);
        const inside = Math.min(n2, half) - Math.max(n1, -half);
        if (inside < JAMB_SPAN * wall.thickness) continue;
        const t = (dot(sub(p, axis.a), axis.dir) + dot(sub(q, axis.a), axis.dir)) / 2;
        if (t < END_MARGIN || t > axis.length - END_MARGIN) continue; // the wall's own end caps
        found.push(t);
    }
    return found;
}

// The nearest jamb on each side of `along` (A: a window between its jambs), or null
function jambsAround(wall, along, segments) {
    const lines = jambLines(wall, segments);
    const from = Math.max(-Infinity, ...lines.filter((t) => t <= along));
    const to = Math.min(Infinity, ...lines.filter((t) => t > along));
    return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null;
}

// A. the opening between the drawing's jambs around the point, on the wall under it
function onWall(level, wall, point, type, segments, id) {
    const jambs = jambsAround(wall, frameOf(wall, point).along, segments);
    if (jambs == null) return null;
    const next = withOpening(level, wall.id, type, (jambs.from + jambs.to) / 2, jambs.to - jambs.from, id);
    return next && { level: next, wallId: wall.id, openingId: id, removedWallId: null };
}

// A gap's edges [from, to] (along `wall`'s axis) narrowed to the walls JOINED AT ITS EDGES: a gap edge at a
// corner (another wall with an end on that drawn point, `ends`) starts at that wall's face towards the gap,
// where the masonry really stops (a corner vertex lies on the walls' lines, inside the corner block)
function clearGap(level, wall, gap, ends) {
    const axis = axisOf(wall);
    let [from, to] = gap;
    const middle = (from + to) / 2;
    for (const end of ends) {
        const same = (p) => Math.hypot(p[0] - end[0], p[1] - end[1]) < 1e-6;
        for (const other of level.walls) {
            if (!(same(other.a) || same(other.b))) continue;
            const { dir, normal } = wallFrame(other);
            const den = cross(axis.dir, dir);
            if (Math.abs(den) < Math.sin((10 * Math.PI) / 180)) continue; // the wall itself, or running on
            const { inner, outer } = faceOffsets(other);
            // where the axis crosses each face of that wall (along the axis), the one nearer the gap's middle
            const faces = [inner, outer].map((offset) => {
                const base = [other.a[0] + normal[0] * offset, other.a[1] + normal[1] * offset];
                return cross(sub(base, axis.a), dir) / den;
            });
            const face = faces.reduce((p, q) => (Math.abs(q - middle) < Math.abs(p - middle) ? q : p));
            if (face > from && face < middle) from = face;
            if (face < to && face > middle) to = face;
        }
    }
    return [from, to];
}

// B / C: the opening in the gap [from, to] (along the joined wall's axis) of the level where the walls were
// joined. On each side, the jamb line of the drawing NEAREST THE GAP'S EDGE (within the gap, JAMB_SLACK
// included) is where the masonry ends: a bit of masonry beside the frame that was not traced becomes wall,
// while a frame drawn as boxes of lines across the wall (further in) stays in the opening. No jamb on a
// side: the gap's edge. Below MIN_OPENING_SIZE: joined only.
function openingInGap(joined, wallId, point, gap, type, segments, id, removedWallId) {
    const wall = joined.walls.find((item) => item.id === wallId);
    const along = frameOf(wall, point).along;
    const lines = jambLines(wall, segments).filter((t) => t >= gap[0] - JAMB_SLACK && t <= gap[1] + JAMB_SLACK);
    const left = lines.filter((t) => t <= along), right = lines.filter((t) => t > along);
    const from = left.length > 0 ? Math.min(...left) : gap[0];
    const to = right.length > 0 ? Math.max(...right) : gap[1];
    if (to - from < MIN_OPENING_SIZE) return { level: joined, wallId, openingId: null, removedWallId };
    const next = withOpening(joined, wallId, type, (from + to) / 2, to - from, id);
    return next && { level: next, wallId, openingId: id, removedWallId };
}

// B. the gap between two walls on one axis: merged into one wall with the gap as the opening
function inGap(level, point, type, segments, id) {
    let best = null;
    for (const first of level.walls) {
        const { axis, along, across } = frameOf(first, point);
        if (Math.abs(across) > first.thickness / 2 + SAME_AXIS) continue;
        for (const second of level.walls) {
            if (second === first || Math.abs(second.thickness - first.thickness) > SAME_AXIS) continue;
            const other = axisOf(second);
            if (Math.abs(cross(axis.dir, other.dir)) > 1e-3) continue;
            const ends = [other.a, [other.a[0] + other.dir[0] * other.length, other.a[1] + other.dir[1] * other.length]];
            if (ends.some((end) => Math.abs(dot(sub(end, axis.a), axis.normal)) > SAME_AXIS)) continue;
            const [s1, s2] = ends.map((end) => dot(sub(end, axis.a), axis.dir)).sort((x, y) => x - y);
            // the gap between the facing ends, holding the point
            const gap = s1 >= axis.length && along >= axis.length && along <= s1 ? [axis.length, s1]
                : s2 <= 0 && along <= 0 && along >= s2 ? [s2, 0] : null;
            if (gap && (best == null || gap[1] - gap[0] < best.gap[1] - best.gap[0])) best = { first, second, gap };
        }
    }
    if (best == null) return null;
    const { first, second, gap } = best;
    // the merged wall: the first one's drawn line run on to the second's far end. That end is brought onto the
    // first's drawn line (the two may be drawn on different lines: axis / a face, different thickness) and
    // the walls joined there move with it (moveVertex): joins kept, the merged wall stays straight
    const { dir } = wallFrame(first);
    const secondEnds = [second.a, second.b];
    const far = secondEnds.reduce((p, q) => (Math.abs(dot(sub(q, first.a), dir) - (gap[0] + gap[1]) / 2) > Math.abs(dot(sub(p, first.a), dir) - (gap[0] + gap[1]) / 2) ? q : p));
    const onLine = [first.a[0] + dir[0] * dot(sub(far, first.a), dir), first.a[1] + dir[1] * dot(sub(far, first.a), dir)];
    if (Math.hypot(onLine[0] - far[0], onLine[1] - far[1]) > 1e-9) {
        // walls arriving ACROSS move their end there (along their own direction: they stay straight); a wall
        // running on straight (near-parallel) keeps its end: moved sideways it would turn slanted
        const same = (p) => Math.hypot(p[0] - far[0], p[1] - far[1]) < 1e-9;
        level = { ...level, walls: level.walls.map((wall) => {
            if (wall.id === second.id || !(same(wall.a) || same(wall.b))) return wall;
            if (Math.abs(cross(wallFrame(wall).dir, dir)) < Math.sin((10 * Math.PI) / 180)) return wall;
            return same(wall.a) ? { ...wall, a: onLine } : { ...wall, b: onLine };
        }) };
    }
    const before = gap[1] <= 0; // the second wall lies before the first one's start
    const a = before ? onLine : first.a, b = before ? first.b : onLine;
    const merged = { ...first, a, b };
    const offsetOf = (wall, opening) => {
        const { dir: d } = wallFrame(wall);
        const center = [wall.a[0] + d[0] * opening.offset, wall.a[1] + d[1] * opening.offset];
        return dot(sub(center, a), wallFrame(merged).dir);
    };
    merged.openings = [...(first.openings ?? []).map((o) => ({ ...o, offset: offsetOf(first, o) })),
        ...(second.openings ?? []).map((o) => ({ ...o, offset: offsetOf(second, o) }))];
    const joined = { ...level, walls: level.walls.filter((wall) => wall.id !== second.id).map((wall) => (wall.id === first.id ? merged : wall)) };
    // the gap along the merged wall's axis (it starts at the merged start), from corner face to corner face
    const shift = dot(sub(axisOf(first).a, axisOf(merged).a), axisOf(merged).dir);
    const nearEnds = [before ? first.a : first.b, secondEnds.find((p) => p !== far)];
    const clear = clearGap(level, first, gap, nearEnds);
    return openingInGap(joined, first.id, point, [clear[0] + shift, clear[1] + shift], type, segments, id, second.id);
}

// C. the gap between a wall's end and another wall crossing its axis further on
function toWall(level, point, type, segments, radius, id) {
    let best = null;
    for (const wall of level.walls) {
        const { axis, along, across } = frameOf(wall, point);
        if (Math.abs(across) > wall.thickness / 2 + radius) continue;
        const atEnd = along > axis.length ? 'b' : along < 0 ? 'a' : null;
        if (atEnd == null) continue;
        const out = atEnd === 'b' ? axis.dir : [-axis.dir[0], -axis.dir[1]];   // away from the wall
        const end = atEnd === 'b' ? [axis.a[0] + axis.dir[0] * axis.length, axis.a[1] + axis.dir[1] * axis.length] : axis.a;
        const reached = Math.abs(along - (atEnd === 'b' ? axis.length : 0));  // the point's distance past the end
        for (const other of level.walls) {
            if (other === wall) continue;
            const { dir, normal, length } = wallFrame(other);
            const den = cross(out, dir);
            if (Math.abs(den) < Math.sin((10 * Math.PI) / 180)) continue;
            // distance along `out` from the end to the line other.a + t·dir + normal·offset (drawn line: offset 0)
            const hit = (offset) => {
                const base = [other.a[0] + normal[0] * offset, other.a[1] + normal[1] * offset];
                return cross(sub(base, end), dir) / den;
            };
            const line = hit(0);
            const { inner, outer } = faceOffsets(other);
            const face = Math.min(hit(inner), hit(outer)); // the near face, seen from the end
            const crossing = [end[0] + out[0] * line, end[1] + out[1] * line];
            const t = dot(sub(crossing, other.a), dir);
            if (face < reached || face > MAX_OPENING || t < -wall.thickness || t > length + wall.thickness) continue;
            if (best == null || face < best.face) best = { wall, atEnd, end, out, other, line, face, crossing, t, length };
        }
        // a wall across the way between the end and the point (a niche's return): this end does not reach it
        if (best?.wall === wall && level.walls.some((other) => other !== wall && crossesBefore(other, end, out, reached))) best = null;
    }
    if (best == null) return null;
    const { wall, atEnd, end, out, other, face, crossing, t, length } = best;
    // the wall runs on to the other wall's drawn line (same point on the drawn line as on the axis: `shift`)
    const { normal } = wallFrame(wall);
    const { inner, outer } = faceOffsets(wall);
    const shift = (inner + outer) / 2; // drawn line -> axis
    const newEnd = [crossing[0] - normal[0] * shift, crossing[1] - normal[1] * shift];
    let next = level;
    // L corner: the other wall's end next to the crossing moves onto it, when that wall is alone at its
    // corner (with others there, e.g. one running on straight, they would turn: the corner stays put)
    const corner = t <= wall.thickness ? other.a : length - t <= wall.thickness ? other.b : null;
    if (corner && aloneAt(next, corner)) next = moveVertex(next, corner, newEnd) ?? next;
    const current = next.walls.find((item) => item.id === wall.id);
    const extended = atEnd === 'b' ? { ...current, b: newEnd } : { ...current, a: newEnd };
    // openings keep their place in the world: offsets measured again from the (possibly new) start
    const startShift = atEnd === 'a' ? dot(sub(current.a, newEnd), wallFrame(extended).dir) : 0;
    extended.openings = (current.openings ?? []).map((o) => ({ ...o, offset: o.offset + startShift }));
    const joined = { ...next, walls: next.walls.map((item) => (item.id === wall.id ? extended : item)) };
    // the gap from the old end (or the face of a wall cornering there) to the near face, along the extended axis
    const g = [end, [end[0] + out[0] * face, end[1] + out[1] * face]].map((p) => dot(sub(p, axisOf(extended).a), axisOf(extended).dir)).sort((x, y) => x - y);
    const ownEnd = atEnd === 'b' ? current.b : current.a;
    const others = { ...joined, walls: joined.walls.filter((item) => item.id !== wall.id) }; // not the wall itself
    return openingInGap(joined, wall.id, point, clearGap(others, extended, g, [ownEnd]), type, segments, id, null);
}

// Whether wall `other` crosses the ray end + s·out (0 < s < reach: before the point), within its length
function crossesBefore(other, end, out, reach) {
    const { dir, length } = wallFrame(other);
    const den = cross(out, dir);
    if (Math.abs(den) < 1e-6) return false;
    const s = cross(sub(other.a, end), dir) / den;               // along the ray
    const t = cross(sub(other.a, end), out) / den;               // along the other wall's drawn line
    const { inner, outer } = faceOffsets(other);
    const reachOfFaces = Math.max(Math.abs(inner), Math.abs(outer)) / Math.abs(den); // its thickness along the ray
    return s - reachOfFaces > 1e-6 && s - reachOfFaces < reach && t >= -1e-6 && t <= length + 1e-6;
}

export function placeOpening(level, point, type, segments, radius, ids = {}) {
    const id = ids.opening ?? newOpeningId();
    // the wall under the point (nearest axis within its half thickness + radius, along its length)
    const hit = level.walls
        .map((wall) => ({ wall, ...frameOf(wall, point) }))
        .filter(({ wall, axis, along, across }) => Math.abs(across) <= wall.thickness / 2 + radius && along >= 0 && along <= axis.length)
        .sort((p, q) => Math.abs(p.across) - Math.abs(q.across))[0];
    return hit ? onWall(level, hit.wall, point, type, segments, id) : inGap(level, point, type, segments, id) ?? toWall(level, point, type, segments, radius, id);
}
