/*
* DXF -> vector UNDERLAY data (builder: a CAD drawing traced under the plan; planModel.js "UNDERLAY",
* kind 'dxf'). Pure functions, no DOM: the parsed DXF object (dxf-parser) goes in, plain JSON comes out.
*
* dxfVectors(dxf) -> { units, width, height, layers: [{ name, segments }] }
* - Kept: LINE, LWPOLYLINE / POLYLINE (bulges = arcs, tessellated), ARC, CIRCLE, and INSERT (blocks: doors,
*   furniture, symbols are often blocks) expanded with their position, scale and rotation, nested blocks too.
*   Skipped: texts, dimensions, hatches, splines, ellipses, points, 3D faces (not needed to trace walls).
* - segments: flat [x1, z1, x2, z2, ...] in DRAWING UNITS, centered on the drawing's bounds (so the underlay's
*   `center` is the drawing center, like an image), plan axes: the CAD's +Y (up on paper) becomes -Z (up on
*   the plan). Rounded to 1e-4 units (smaller JSON).
* - units: from the header ($INSUNITS) when declared, else guessed from the drawing's size (dxfUnitsGuess).
* ponytail: a whole drawing in one JSON (fine up to ~100k segments); tile / simplify if huge drawings show up.
*/
export const UNIT_METERS = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
const INSUNITS = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
const ARC_STEP = Math.PI / 24;      // tessellation: 7.5° per segment
const MAX_BLOCK_DEPTH = 8;          // nested blocks deeper than this are ignored (cycles, broken files)
const ROUND = 1e4;

// Units of a drawing that does not declare them, from its largest extent (a building is 5-100 m):
// thousands of units = mm, hundreds = cm, else m
export function dxfUnitsGuess(extent) {
    if (extent > 1500) return 'mm';
    if (extent > 150) return 'cm';
    return 'm';
}

// 2D affine transform [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (DXF axes, y up)
const IDENTITY = [1, 0, 0, 1, 0, 0];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const compose = (m, n) => [ // m after n
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
];

// Points of an arc (center, radius, start / end angles in radians, counter-clockwise)
function arcPoints(cx, cy, r, start, end) {
    let sweep = end - start;
    while (sweep <= 0) sweep += 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(sweep / ARC_STEP));
    const points = [];
    for (let i = 0; i <= steps; i++) {
        const a = start + (sweep * i) / steps;
        points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return points;
}

// Points of a polyline, its bulges (arc segments: bulge = tan(angle / 4), positive = counter-clockwise) tessellated
function polylinePoints(vertices, closed) {
    const points = [];
    const count = vertices.length;
    for (let i = 0; i < count; i++) {
        const v = vertices[i];
        points.push([v.x, v.y]);
        const next = vertices[(i + 1) % count];
        if (!v.bulge || (i === count - 1 && !closed)) continue;
        const angle = 4 * Math.atan(v.bulge);
        const chord = Math.hypot(next.x - v.x, next.y - v.y);
        if (chord < 1e-9) continue;
        const r = chord / (2 * Math.sin(Math.abs(angle) / 2));
        // center: on the chord's perpendicular, at the sagitta-side distance
        const mx = (v.x + next.x) / 2, my = (v.y + next.y) / 2;
        const h = Math.sqrt(Math.max(r * r - (chord / 2) ** 2, 0)) * Math.sign(v.bulge) * (Math.abs(angle) > Math.PI ? -1 : 1);
        const cx = mx - (h * (next.y - v.y)) / chord, cy = my + (h * (next.x - v.x)) / chord;
        const start = Math.atan2(v.y - cy, v.x - cx), end = Math.atan2(next.y - cy, next.x - cx);
        const arc = angle > 0 ? arcPoints(cx, cy, r, start, end) : arcPoints(cx, cy, r, end, start).reverse();
        points.push(...arc.slice(1, -1));
    }
    if (closed && count > 1) points.push([vertices[0].x, vertices[0].y]);
    return points;
}

export function dxfVectors(dxf) {
    const byLayer = new Map(); // layer -> flat [x1, y1, x2, y2, ...] (DXF axes, units)
    const add = (layer, m, points) => {
        if (!byLayer.has(layer)) byLayer.set(layer, []);
        const list = byLayer.get(layer);
        for (let i = 1; i < points.length; i++) {
            const [x1, y1] = apply(m, points[i - 1][0], points[i - 1][1]);
            const [x2, y2] = apply(m, points[i][0], points[i][1]);
            list.push(x1, y1, x2, y2);
        }
    };

    const walk = (entities, m, depth, parentLayer) => {
        for (const entity of entities ?? []) {
            // entities of a block on layer "0" take the layer of the INSERT (CAD convention)
            const layer = entity.layer && entity.layer !== '0' ? entity.layer : (parentLayer ?? entity.layer ?? '0');
            switch (entity.type) {
                case 'LINE':
                    if (entity.vertices?.length >= 2) add(layer, m, entity.vertices.map((v) => [v.x, v.y]));
                    break;
                case 'LWPOLYLINE':
                case 'POLYLINE':
                    if (entity.vertices?.length >= 2) add(layer, m, polylinePoints(entity.vertices, Boolean(entity.shape)));
                    break;
                case 'ARC':
                    add(layer, m, arcPoints(entity.center.x, entity.center.y, entity.radius, entity.startAngle, entity.endAngle));
                    break;
                case 'CIRCLE':
                    add(layer, m, arcPoints(entity.center.x, entity.center.y, entity.radius, 0, 2 * Math.PI));
                    break;
                case 'INSERT': {
                    const block = dxf.blocks?.[entity.name];
                    if (block == null || depth >= MAX_BLOCK_DEPTH) break;
                    const angle = ((entity.rotation ?? 0) * Math.PI) / 180;
                    const sx = entity.xScale ?? 1, sy = entity.yScale ?? 1;
                    const base = block.position ?? { x: 0, y: 0 };
                    const cos = Math.cos(angle), sin = Math.sin(angle);
                    // insert transform: translate(position) . rotate . scale . translate(-base point)
                    const local = [cos * sx, sin * sx, -sin * sy, cos * sy, 0, 0];
                    const [bx, by] = apply(local, base.x, base.y);
                    const placed = [...local.slice(0, 4), entity.position.x - bx, entity.position.y - by];
                    walk(block.entities, compose(m, placed), depth + 1, layer);
                    break;
                }
                default: // texts, dimensions, hatches, splines...: not needed to trace walls
            }
        }
    };
    walk(dxf.entities, IDENTITY, 0, null);

    // bounds -> centered, plan axes (z = -y), rounded
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const list of byLayer.values()) {
        for (let i = 0; i < list.length; i += 2) {
            if (list[i] < minX) minX = list[i];
            if (list[i] > maxX) maxX = list[i];
            if (list[i + 1] < minY) minY = list[i + 1];
            if (list[i + 1] > maxY) maxY = list[i + 1];
        }
    }
    if (!Number.isFinite(minX)) throw new Error('No lines found in this DXF');
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const round = (value) => Math.round(value * ROUND) / ROUND;
    const layers = [...byLayer.entries()]
        .map(([name, list]) => ({ name, segments: list.map((value, i) => round(i % 2 === 0 ? value - cx : cy - value)) }))
        .sort((p, q) => p.name.localeCompare(q.name));
    const width = maxX - minX, height = maxY - minY;
    const units = INSUNITS[dxf.header?.$INSUNITS] ?? dxfUnitsGuess(Math.max(width, height));
    return { units, width, height, layers };
}
