import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/*
* AO BAKE of the room (docs/plans/2026-10-29-feat-baked-room-ao-plan.md, U2): fills the atlas made by aoAtlas.js.
* Pure (no DOM): runs in the workers (aoWorker.js, several in parallel: aoBaker.js) and in Node (bakeAo.check.mjs).
*
* bakeTexels(size, faces, options) -> { values: Float32Array, covered: Uint8Array } (size * size each)
* - faces: [{ position, normal, uv1, index }] typed arrays of aoAtlas' geometries (room space). They are both the
*   RECEIVERS (their texels get a value) and the OCCLUDERS (rays hit them: furniture is never in here, D1).
* - Each triangle is rasterized in atlas pixels: a texel whose center lies inside it gets the triangle's point
*   and normal there. From the point (lifted by EPSILON along the normal) `rays` cosine-weighted rays over the
*   hemisphere test the room within `radius`: a hit at distance d occludes by (1 - d / radius), so the effect fades
*   out smoothly at the radius. The ray set is a fixed Hammersley pattern turned by a per-texel hash (noise
*   rather than banding).
* - Only the rows y with y % rowStride === rowOffset: the workers split the atlas by interleaved rows (an even
*   share of the charts each). The rays are the whole cost (~1.5 us each with the BVH on an M2 Max).
* finishAo(size, values, covered) -> Uint8Array (255 = open, 0 = fully occluded), after merging the workers' rows:
* - a 3 x 3 blur over covered texels only (charts are 2 * PAD apart: it never mixes two faces) smooths the noise;
* - uncovered texels next to covered ones are filled from them, PAD rings (aoAtlas.js PAD): linear filtering at
*   a chart's border never reads the empty background. The rest stays 255.
* bakeAo(size, faces, options) = both, in one go (the check).
* Calibration knobs (tune on the headset): rays, radius (and aoAtlas' texel); the strength is ROOM_AO_INTENSITY.
*/
export const AO_RAYS = 16;
export const AO_RADIUS = 1; // meters: the "contact" reach, not distant shadowing
const EPSILON = 0.002;      // meters: ray start above the surface (no self-hit at shared edges)
const DILATE = 2;           // rings of border fill (= aoAtlas PAD)

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();
const _n = new Vector3(), _t = new Vector3(), _s = new Vector3();
const _p = new Vector3();
const _ray = new Ray();

// Hammersley point i of n -> cosine-weighted direction in tangent space [x, y, z] (z = along the normal)
function hemisphere(n) {
    const directions = [];
    for (let i = 0; i < n; i++) {
        let bits = i;
        bits = ((bits << 16) | (bits >>> 16)) >>> 0;
        bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
        bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
        bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
        bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
        const u = (i + 0.5) / n, v = bits / 4294967296;
        const r = Math.sqrt(u), phi = 2 * Math.PI * v;
        directions.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)]);
    }
    return directions;
}

// All faces as one indexed geometry, for the BVH
function mergedOccluders(faces) {
    const vertexCount = faces.reduce((sum, face) => sum + face.position.length / 3, 0);
    const position = new Float32Array(vertexCount * 3);
    const index = [];
    let offset = 0;
    for (const face of faces) {
        position.set(face.position, offset * 3);
        for (const i of face.index) index.push(i + offset);
        offset += face.position.length / 3;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setIndex(index);
    return geometry;
}

export function bakeTexels(size, faces, { rays = AO_RAYS, radius = AO_RADIUS, rowOffset = 0, rowStride = 1 } = {}) {
    const bvh = new MeshBVH(mergedOccluders(faces));
    const directions = hemisphere(rays);
    const values = new Float32Array(size * size).fill(1);
    const covered = new Uint8Array(size * size);

    for (const face of faces) {
        const { position, normal, uv1, index } = face;
        for (let t = 0; t < index.length; t += 3) {
            const [ia, ib, ic] = [index[t], index[t + 1], index[t + 2]];
            const ax = uv1[ia * 2] * size, ay = uv1[ia * 2 + 1] * size;
            const bx = uv1[ib * 2] * size, by = uv1[ib * 2 + 1] * size;
            const cx = uv1[ic * 2] * size, cy = uv1[ic * 2 + 1] * size;
            const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
            if (Math.abs(area) < 1e-12) continue;
            _a.fromArray(position, ia * 3); _b.fromArray(position, ib * 3); _c.fromArray(position, ic * 3);
            _n.fromArray(normal, ia * 3).normalize();
            // tangent frame of the normal
            _t.set(Math.abs(_n.y) > 0.9 ? 1 : 0, Math.abs(_n.y) > 0.9 ? 0 : 1, 0).cross(_n).normalize();
            _s.crossVectors(_n, _t);
            const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
            const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
            // first row of this worker's share at or after y0
            for (let y = y0 + ((rowOffset - y0 % rowStride) + rowStride) % rowStride; y <= y1; y += rowStride) {
                for (let x = x0; x <= x1; x++) {
                    const texel = y * size + x;
                    if (covered[texel]) continue;
                    // barycentric of the texel center
                    const px = x + 0.5, py = y + 0.5;
                    const wb = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / area;
                    const wc = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / area;
                    const wa = 1 - wb - wc;
                    if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
                    covered[texel] = 1;
                    _p.set(0, 0, 0).addScaledVector(_a, wa).addScaledVector(_b, wb).addScaledVector(_c, wc).addScaledVector(_n, EPSILON);
                    // per-texel rotation of the ray set (integer hash -> angle)
                    const angle = (((Math.imul(texel, 2654435761) >>> 0) % 1024) / 1024) * 2 * Math.PI;
                    const cos = Math.cos(angle), sin = Math.sin(angle);
                    let occlusion = 0;
                    for (const [dx, dy, dz] of directions) {
                        const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
                        _ray.origin.copy(_p);
                        _ray.direction.set(0, 0, 0).addScaledVector(_t, rx).addScaledVector(_s, ry).addScaledVector(_n, dz);
                        const hit = bvh.raycastFirst(_ray, DoubleSide, 0, radius);
                        if (hit) occlusion += 1 - hit.distance / radius;
                    }
                    values[texel] = 1 - occlusion / rays;
                }
            }
        }
    }
    return { values, covered };
}

// The workers' rows ([{ values, covered }], each set only its own) as one [values, covered]: covered texels win
export function mergeRows(size, parts) {
    const values = new Float32Array(size * size).fill(1);
    const covered = new Uint8Array(size * size);
    for (const part of parts) {
        for (let i = 0; i < covered.length; i++) {
            if (part.covered[i]) { covered[i] = 1; values[i] = part.values[i]; }
        }
    }
    return [values, covered];
}

export function finishAo(size, values, covered) {
    covered = covered.slice();
    // 3 x 3 blur over covered texels only
    const blurred = new Float32Array(values);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!covered[y * size + x]) continue;
            let sum = 0, count = 0;
            for (let j = Math.max(0, y - 1); j <= Math.min(size - 1, y + 1); j++) {
                for (let i = Math.max(0, x - 1); i <= Math.min(size - 1, x + 1); i++) {
                    if (covered[j * size + i]) { sum += values[j * size + i]; count++; }
                }
            }
            blurred[y * size + x] = sum / count;
        }
    }

    // border fill: each ring takes the average of its covered neighbors
    for (let ring = 0; ring < DILATE; ring++) {
        const next = covered.slice();
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (covered[y * size + x]) continue;
                let sum = 0, count = 0;
                for (let j = Math.max(0, y - 1); j <= Math.min(size - 1, y + 1); j++) {
                    for (let i = Math.max(0, x - 1); i <= Math.min(size - 1, x + 1); i++) {
                        if (covered[j * size + i]) { sum += blurred[j * size + i]; count++; }
                    }
                }
                if (count > 0) { blurred[y * size + x] = sum / count; next[y * size + x] = 1; }
            }
        }
        covered.set(next);
    }

    const out = new Uint8Array(size * size);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, blurred[i])) * 255);
    return out;
}

export function bakeAo(size, faces, options) {
    const { values, covered } = bakeTexels(size, faces, options);
    return finishAo(size, values, covered);
}

// aoAtlas geometries -> the typed arrays bakeTexels (and the workers) take
export const bakeInput = (geometries) => geometries.map((geometry) => ({
    position: geometry.attributes.position.array,
    normal: geometry.attributes.normal.array,
    uv1: geometry.attributes.uv1.array,
    index: geometry.index.array
}));
