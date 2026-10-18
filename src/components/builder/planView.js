/*
* Pure helpers of the 2D plan view (PlanView2D.jsx): camera math and grid lines, no React.
*
* View: { cx, cz, scale } — world point (meters) at the center of the view, pixels per meter.
* Screen axes: world X -> right, world Z -> down (top view looking down -Y, north = -Z up).
*/
import { faceOffsets, openingRects, wallFootprint, wallFrame } from '../../plan/planModel.js';

export const MIN_SCALE = 5;     // px per meter: whole building
export const MAX_SCALE = 2000;  // px per meter: millimeter detail
const FIT_MARGIN = 1;           // meters of empty space around the level when fitting

const clampScale = (scale) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

// View that shows the whole of `bounds` (planModel.levelBounds) in a w x h pixel area
export function fitView(bounds, w, h) {
    const width = bounds.max[0] - bounds.min[0] + 2 * FIT_MARGIN;
    const depth = bounds.max[1] - bounds.min[1] + 2 * FIT_MARGIN;
    return { cx: bounds.center[0], cz: bounds.center[1], scale: clampScale(Math.min(w / width, h / depth)) };
}

// Screen pixel (relative to the view's top-left corner) -> world [x, z]
export function toWorld(view, w, h, px, py) {
    return [view.cx + (px - w / 2) / view.scale, view.cz + (py - h / 2) / view.scale];
}

// World [x, z] -> screen pixel [px, py] (relative to the view's top-left corner)
export function toScreen(view, w, h, x, z) {
    return [(x - view.cx) * view.scale + w / 2, (z - view.cz) * view.scale + h / 2];
}

// Zoom by `factor` keeping the world point under the screen pixel (px, py) still
export function zoomAt(view, w, h, px, py, factor) {
    const [x, z] = toWorld(view, w, h, px, py);
    const scale = clampScale(view.scale * factor);
    return { cx: x - (px - w / 2) / scale, cz: z - (py - h / 2) / scale, scale };
}

// Move the view by a screen delta in pixels (the content follows the pointer)
export function panBy(view, dx, dy) {
    return { ...view, cx: view.cx - dx / view.scale, cz: view.cz - dy / view.scale };
}

// Grid steps (meters) readable at this scale: minor lines at least ~8 px apart, major = 10 minor
export function gridSteps(scale) {
    const minor = [0.1, 0.5, 1, 5, 10].find((step) => step * scale >= 8) ?? 10;
    return { minor, major: minor * 10 };
}

// SVG path ("M x z V z2 ..." in world meters) of the grid lines with `step` inside the visible area
export function gridPath(view, w, h, step) {
    const [x0, z0] = toWorld(view, w, h, 0, 0);
    const [x1, z1] = toWorld(view, w, h, w, h);
    let d = '';
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) d += `M${x.toFixed(3)} ${z0}V${z1}`;
    for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) d += `M${x0} ${z.toFixed(3)}H${x1}`;
    return d;
}

/*
* Alignment snap (plan editor): the coordinate of `point` closest to the same coordinate of one of
* `targets` ([x, z] corners), within `tolerance` meters, snaps to it, separately for X and Z. Returns
* { point, guides }: guides = [{ from: target, to: snapped point }] (one per snapped axis), drawn as dashed
* lines from the corner the point lines up with.
*/
export function alignPoint(point, targets, tolerance) {
    let [x, z] = point;
    let alongX = null, alongZ = null; // target the X / Z coordinate snapped to
    let bestX = tolerance, bestZ = tolerance;
    for (const target of targets) {
        const dx = Math.abs(target[0] - point[0]);
        const dz = Math.abs(target[1] - point[1]);
        if (dx <= bestX) { bestX = dx; alongX = target; }
        if (dz <= bestZ) { bestZ = dz; alongZ = target; }
    }
    if (alongX) x = alongX[0];
    if (alongZ) z = alongZ[1];
    const snapped = [x, z];
    const guides = [alongX, alongZ].filter(Boolean).map((from) => ({ from, to: snapped }));
    return { point: snapped, guides };
}

// Angle in (-PI, PI]
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

/*
* Angle snap ("polar tracking") of the segment origin -> point: its direction, measured from `refAngle`
* (radians, screen/plan axes: x right, z down), snaps to the nearest multiple of `stepDeg` when within
* `toleranceDeg`; the point is projected on that ray (same distance along it). refAngle = the previous
* wall's direction (0 = straight on, 90 = square to it) or 0 for a first wall (multiples of the step from
* the plan's X axis). Returns { point, angle } (angle = absolute snapped direction) or null when not snapped.
*/
export function angleSnap(origin, point, refAngle, stepDeg, toleranceDeg) {
    const dx = point[0] - origin[0], dz = point[1] - origin[1];
    if (Math.hypot(dx, dz) < 1e-6 || !(stepDeg > 0)) return null;
    const step = stepDeg * Math.PI / 180;
    const relative = wrapAngle(Math.atan2(dz, dx) - refAngle);
    const snappedRelative = Math.round(relative / step) * step;
    if (Math.abs(wrapAngle(relative - snappedRelative)) > toleranceDeg * Math.PI / 180) return null;
    const angle = refAngle + snappedRelative;
    const along = dx * Math.cos(angle) + dz * Math.sin(angle);
    if (along <= 0) return null;
    return { point: [origin[0] + along * Math.cos(angle), origin[1] + along * Math.sin(angle)], angle };
}

// Smaller angle (degrees, 0..180) between the rays center -> p and center -> q
export function angleBetween(center, p, q) {
    const a = Math.atan2(p[1] - center[1], p[0] - center[0]);
    const b = Math.atan2(q[1] - center[1], q[0] - center[0]);
    return Math.abs(wrapAngle(b - a)) * 180 / Math.PI;
}

// Does segment p-q cross the axis-aligned rectangle [min, max] (an end inside, or crossing an edge)?
function segmentHitsRect(p, q, min, max) {
    const inside = (r) => r[0] >= min[0] && r[0] <= max[0] && r[1] >= min[1] && r[1] <= max[1];
    if (inside(p) || inside(q)) return true;
    const corners = [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]];
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const intersects = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
    return corners.some((c, i) => intersects(p, q, c, corners[(i + 1) % 4]));
}

/*
* Box selection (plan editor), CAD style, on the walls' drawn lines (a -> b), world coordinates:
* - window (crossing = false, box dragged left -> right): walls entirely inside the box;
* - crossing (crossing = true, dragged right -> left): walls inside OR touched by the box.
* `corner1` / `corner2`: any two opposite corners. Returns the wall ids.
*/
export function wallsInBox(walls, corner1, corner2, crossing) {
    const min = [Math.min(corner1[0], corner2[0]), Math.min(corner1[1], corner2[1])];
    const max = [Math.max(corner1[0], corner2[0]), Math.max(corner1[1], corner2[1])];
    const inside = (r) => r[0] >= min[0] && r[0] <= max[0] && r[1] >= min[1] && r[1] <= max[1];
    return walls
        .filter((wall) => (crossing ? segmentHitsRect(wall.a, wall.b, min, max) : inside(wall.a) && inside(wall.b)))
        .map((wall) => wall.id);
}

/*
* RULER SNAP in the 2D plan: the point under the pointer snaps to the nearest of `vertices` ([x, z]) within
* `radius` meters ('vertex'), else to the nearest point of `segments` ([[x, z], [x, z]]) within `radius`
* ('edge', with that segment), else nothing (kind null: the caller uses the grid or the raw point).
*/
export function rulerSnap2D(point, vertices, segments, radius) {
    let best = null, bestDistance = radius;
    for (const vertex of vertices) {
        const distance = Math.hypot(vertex[0] - point[0], vertex[1] - point[1]);
        if (distance <= bestDistance) { best = vertex; bestDistance = distance; }
    }
    if (best) return { point: [best[0], best[1]], kind: 'vertex' };
    let edge = null;
    bestDistance = radius;
    for (const segment of segments) {
        const nearest = nearestOnSegment(point, segment[0], segment[1]);
        const distance = Math.hypot(nearest[0] - point[0], nearest[1] - point[1]);
        if (distance <= bestDistance) { edge = { point: nearest, kind: 'edge', segment }; bestDistance = distance; }
    }
    return edge ?? { point, kind: null };
}

/*
* CAD SNAP TARGETS of a DXF underlay (planModel.js level.underlay, kind 'dxf'): its visible layers'
* segments (drawing units, centered: dxfUnderlay.js) placed in the plan like the drawing (scaled by
* metersPerPixel, turned by rotation, moved onto center) -> { vertices: [[x, z]], segments: [[[x, z], [x, z]]] }
* (the segment ends are the vertices). Built once per underlay change (memoized by the caller).
* ponytail: linear scans on every pointer move (fine up to ~100k segments); a grid index if bigger drawings lag.
*/
export function underlayTargets(underlay, layers) {
    const hidden = new Set(underlay.hiddenLayers ?? []);
    const k = underlay.metersPerPixel;
    const c = Math.cos(underlay.rotation) * k, s = Math.sin(underlay.rotation) * k;
    const [cx, cz] = underlay.center;
    // same turn as the drawing (positive = clockwise on screen: x right, z down)
    const place = (x, z) => [cx + x * c - z * s, cz + x * s + z * c];
    const vertices = [], segments = [];
    for (const { name, segments: list } of layers) {
        if (hidden.has(name)) continue;
        for (let i = 0; i < list.length; i += 4) {
            const a = place(list[i], list[i + 1]), b = place(list[i + 2], list[i + 3]);
            vertices.push(a, b);
            segments.push([a, b]);
        }
    }
    return { vertices, segments };
}

/*
* Ruler / wall-tool snap with a CAD underlay: the plan's own targets (`own`: walls, openings, measures) and
* the drawing's (`cad`, underlayTargets), all within `radius` meters. Priority: a plan corner > a CAD end
* point > a plan edge > a CAD line (the plan being drawn wins; then the drawing's precise points).
* Returns rulerSnap2D's { point, kind: 'vertex' | 'edge' | null, segment? } plus `cad: true` when it is the
* drawing's.
*/
export function snapWithUnderlay(point, own, cad, radius) {
    const plan = rulerSnap2D(point, own.vertices, own.segments, radius);
    if (plan.kind === 'vertex') return plan;
    const end = rulerSnap2D(point, cad.vertices, [], radius);
    if (end.kind) return { ...end, cad: true };
    if (plan.kind === 'edge') return plan;
    const line = rulerSnap2D(point, [], cad.segments, radius);
    return line.kind ? { ...line, cad: true } : line;
}
export const NO_TARGETS = { vertices: [], segments: [] };

function nearestOnSegment(p, a, b) {
    const d = [b[0] - a[0], b[1] - a[1]];
    const lengthSq = d[0] * d[0] + d[1] * d[1];
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / lengthSq)) : 0;
    return [a[0] + d[0] * t, a[1] + d[1] * t];
}

/*
* AXIS LOCK of the 2D ruler (default after the first point; Shift = free): the measure runs along the
* plan's X or Z axis through `start`, the one the raw `pointer` is further along. The end is `snap`
* ({ point, kind, segment? } from rulerSnap2D) brought onto that axis: an edge = where the axis line
* crosses the edge's line (exact clear distance to a wall face; projection if nearly parallel); a vertex
* or a free point = its projection on the axis (the measure reaches exactly its coordinate).
* Returns { point, axis: 'x' | 'z' }.
*/
export function lockToPlanAxis(start, pointer, snap) {
    const axis = Math.abs(pointer[0] - start[0]) >= Math.abs(pointer[1] - start[1]) ? 'x' : 'z';
    const projected = axis === 'x' ? [snap.point[0], start[1]] : [start[0], snap.point[1]];
    if (snap.kind !== 'edge') return { point: projected, axis };
    const [a, b] = snap.segment;
    const d = [b[0] - a[0], b[1] - a[1]];
    const length = Math.hypot(d[0], d[1]);
    // axis line: start + s * u (u = unit X or Z); edge line: a + t * d
    const u = axis === 'x' ? [1, 0] : [0, 1];
    const den = u[0] * d[1] - u[1] * d[0];
    if (length === 0 || Math.abs(den) / length < 0.05) return { point: projected, axis }; // nearly parallel
    const s = ((a[0] - start[0]) * d[1] - (a[1] - start[1]) * d[0]) / den;
    return { point: [start[0] + u[0] * s, start[1] + u[1] * s], axis };
}

// ---------------------------------------------------------------------------------------------------
// RULER MEASURES seen from above (PlanMeasures.jsx draws them, PlanView2D.jsx snaps to them)
// ---------------------------------------------------------------------------------------------------
const MEASURE_COLOR = '#ff9a1a'; // my temporary measures (the 3D ruler's orange)
const MIN_PLAN_LENGTH = 0.01;    // meters: shorter than this seen from above = vertical measure, hidden

// A stored end ({ p, ... } or an old plain [x, y, z]) -> [x, y, z]
const endPoint = (end) => (Array.isArray(end) ? end : end.p);
const plan = (p) => [p[0], p[2]];
const length3 = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);

// Measures drawn in the plan: [{ id, a, b ([x, z]), ya, yb (heights), length (3D, m), color, saved }]
export function planMeasureList(measures) {
    const list = [
        ...measures.items.map((m) => ({ m, color: m.author?.color ?? MEASURE_COLOR, saved: true })),
        ...measures.local.map((m) => ({ m, color: MEASURE_COLOR, saved: false }))
    ];
    return list.map(({ m, color, saved }) => {
        const a = endPoint(m.a), b = endPoint(m.b);
        return { id: m.id, a: plan(a), b: plan(b), ya: a[1], yb: b[1], length: length3(a, b), color, saved };
    }).filter((item) => Math.hypot(item.b[0] - item.a[0], item.b[1] - item.a[1]) >= MIN_PLAN_LENGTH);
}

// Snap targets of the 2D ruler: { vertices: [[x, z]], segments: [[[x, z], [x, z]]] }
export function rulerTargets(level, measureList) {
    const vertices = [], segments = [];
    for (const wall of level.walls) {
        const f = wallFootprint(wall, level.walls);
        vertices.push(f.a, f.b, f.aOut, f.bOut);
        segments.push([f.a, f.b], [f.aOut, f.bOut]);
        const { dir, normal } = wallFrame(wall);
        const { inner, outer } = faceOffsets(wall);
        const at = (t, offset) => [wall.a[0] + dir[0] * t + normal[0] * offset, wall.a[1] + dir[1] * t + normal[1] * offset];
        for (const { from, to } of openingRects(wall, wall.height ?? level.wallHeight)) {
            vertices.push(at(from, inner), at(from, outer), at(to, inner), at(to, outer));
            segments.push([at(from, inner), at(from, outer)], [at(to, inner), at(to, outer)]); // jambs
        }
    }
    for (const item of measureList) {
        vertices.push(item.a, item.b);
        segments.push([item.a, item.b]);
    }
    return { vertices, segments };
}
