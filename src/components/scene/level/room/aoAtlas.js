import { BufferAttribute, BufferGeometry, Vector3 } from 'three';

/*
* AO ATLAS of the room (docs/plans/2026-10-29-feat-baked-room-ao-plan.md, U1): one texture for every face of the
* room, read by three's aoMap through a second UV set (`uv1`, aoMap.channel = 1).
*
* aoAtlas(geometries, texel) -> { geometries, size, texel, charts }
* - geometries: the room's face geometries (roomFaces: indexed, room space). A face can hold several planes (a
*   wall's edge: top, free ends, reveals; a raised floor: its sides), so each face is split into CHARTS: its
*   triangles grouped by plane (vertex normal + distance). A chart is projected onto its plane, in meters.
* - The charts' rectangles (PAD texels of margin all around: the filtering never reads a neighbor) are packed
*   on shelves into a square atlas of `size` px, the smallest power of two that holds them; past MAX_SIZE the
*   texel grows (big plans: coarser AO rather than a huge texture).
* - Returns NEW geometries (same triangles and attributes, vertices duplicated where a vertex was shared by two
*   charts) with `uv1`; every face gets it, as mergeFaces (roomGeometry.js) needs the same attributes everywhere.
* - charts: [{ face, origin, u, v, normal, x, y, w, h }] for the baker (U2): texel (x + PAD + i, y + PAD + j) of
*   the atlas is the point origin + u * (i + 0.5) * texel + v * (j + 0.5) * texel (room space, unit u / v / normal).
* Row 0 of the atlas is uv1 v = 0 (a DataTexture with flipY false).
*/
// meters per texel (calibration knob: tune on the headset). 10 cm: the AO reaches 1 m and changes slowly, and
// 5 cm cost 4x the rays (a 19 x 11 m attic: 20 s on an M2 Max at 5 cm / 32 rays)
export const AO_TEXEL = 0.1;
export const PAD = 2;         // texels of margin around each chart
const MAX_SIZE = 2048;        // px: atlas side cap
const MIN_SIZE = 64;

const _p = new Vector3();
const _n = new Vector3();
const _rel = new Vector3();

// Orthonormal basis of a plane: u horizontal when it can be (walls: along the wall; floors: world x)
function planeBasis(normal) {
    const u = Math.abs(normal.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0).cross(normal).normalize();
    const v = new Vector3().crossVectors(normal, u).normalize();
    return { u, v };
}

// Triangles of a geometry grouped by plane: [{ normal, triangles: [first index of each triangle] }]
function splitCharts(geometry) {
    const index = geometry.index.array;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const charts = new Map();
    for (let t = 0; t < index.length; t += 3) {
        const a = index[t];
        _n.fromBufferAttribute(normal, a).normalize();
        _p.fromBufferAttribute(position, a);
        const key = `${Math.round(_n.x * 1e3)},${Math.round(_n.y * 1e3)},${Math.round(_n.z * 1e3)},${Math.round(_n.dot(_p) * 1e3)}`;
        if (!charts.has(key)) charts.set(key, { normal: _n.clone(), triangles: [] });
        charts.get(key).triangles.push(t);
    }
    return [...charts.values()];
}

// Shelf packing of rects ({ w, h } px) into a size x size square: sets x, y; false if they do not fit
function pack(rects, size) {
    let x = 0, y = 0, shelf = 0;
    for (const rect of [...rects].sort((a, b) => b.h - a.h)) {
        if (rect.w > size) return false;
        if (x + rect.w > size) { x = 0; y += shelf; shelf = 0; }
        if (y + rect.h > size) return false;
        rect.x = x;
        rect.y = y;
        x += rect.w;
        shelf = Math.max(shelf, rect.h);
    }
    return true;
}

export function aoAtlas(geometries, texel = AO_TEXEL) {
    // charts in plane coordinates (meters)
    const charts = geometries.flatMap((geometry, face) => splitCharts(geometry).map((chart) => {
        const { u, v } = planeBasis(chart.normal);
        const position = geometry.attributes.position;
        const index = geometry.index.array;
        let minS = Infinity, minT = Infinity, maxS = -Infinity, maxT = -Infinity;
        for (const t of chart.triangles) {
            for (let k = 0; k < 3; k++) {
                _p.fromBufferAttribute(position, index[t + k]);
                minS = Math.min(minS, _p.dot(u)); maxS = Math.max(maxS, _p.dot(u));
                minT = Math.min(minT, _p.dot(v)); maxT = Math.max(maxT, _p.dot(v));
            }
        }
        // origin: the plane point at (minS, minT)
        _p.fromBufferAttribute(position, index[chart.triangles[0]]);
        const origin = _p.clone().addScaledVector(u, minS - _p.dot(u)).addScaledVector(v, minT - _p.dot(v));
        return { face, triangles: chart.triangles, origin, u, v, normal: chart.normal, sizeS: maxS - minS, sizeT: maxT - minT };
    }));

    // pack: smallest power-of-two square, else a bigger texel
    let size = MIN_SIZE;
    for (;;) {
        for (const chart of charts) {
            chart.w = Math.max(1, Math.ceil(chart.sizeS / texel - 1e-6)) + 2 * PAD;
            chart.h = Math.max(1, Math.ceil(chart.sizeT / texel - 1e-6)) + 2 * PAD;
        }
        if (pack(charts, size)) break;
        if (size < MAX_SIZE) size *= 2;
        else texel *= 1.25;
    }

    // new geometries: each chart's vertices on their own, uv1 from the chart's rect
    const out = geometries.map((geometry, face) => {
        const names = Object.keys(geometry.attributes);
        const values = Object.fromEntries(names.map((name) => [name, []]));
        const uv1 = [];
        const index = [];
        const sourceIndex = geometry.index.array;
        for (const chart of charts.filter((c) => c.face === face)) {
            const remap = new Map(); // source vertex -> new vertex, within this chart
            for (const t of chart.triangles) {
                for (let k = 0; k < 3; k++) {
                    const source = sourceIndex[t + k];
                    if (!remap.has(source)) {
                        remap.set(source, uv1.length / 2); // the new vertex's index = vertices written so far
                        for (const name of names) {
                            const attribute = geometry.attributes[name];
                            for (let c = 0; c < attribute.itemSize; c++) values[name].push(attribute.array[source * attribute.itemSize + c]);
                        }
                        _rel.fromBufferAttribute(geometry.attributes.position, source).sub(chart.origin);
                        uv1.push((chart.x + PAD + _rel.dot(chart.u) / texel) / size, (chart.y + PAD + _rel.dot(chart.v) / texel) / size);
                    }
                    index.push(remap.get(source));
                }
            }
        }
        const result = new BufferGeometry();
        for (const name of names) {
            const attribute = geometry.attributes[name];
            result.setAttribute(name, new BufferAttribute(new attribute.array.constructor(values[name]), attribute.itemSize));
        }
        result.setAttribute('uv1', new BufferAttribute(new Float32Array(uv1), 2));
        result.setIndex(index);
        return result;
    });

    return {
        geometries: out,
        size,
        texel,
        charts: charts.map(({ face, origin, u, v, normal, x, y, w, h }) => ({ face, origin, u, v, normal, x, y, w, h }))
    };
}
