import { BufferGeometry, Float32BufferAttribute, Shape, ShapeGeometry, ShapeUtils, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { planarUVs } from './roomGeometry.js';
import { beamsFaceId, BEAM_SIZE, dormerAt, dormerBeams, dormerFootprint, dormerLines, roofEaves, dormerSolids, dormerWallsFaceId, roofDormers, ceilingHeight, facetArea, facetNormal, roofBeams, roofFacets, roofHeightAt, faceOffsets, floorElevation, openingFloors, openingRects, pointInPolygon, polygonArea, wallFootprint, wallFrame } from '../../../../plan/planModel.js';

/*
* The faces of a plan level (plan/planModel.js) as geometry: what Room.jsx draws and what the bill of
* quantities measures (surfaceAreas), so both always agree.
*
* - Floors: polygons, world-space UVs in meters (planarUVs, same rule as before), plus the strips under the
*   floor-level openings they run through (planModel.openingFloors: the chosen room's floor fills the
*   opening's depth, no threshold; same UVs, so the pattern continues). A floor at an ELEVATION
*   (floor.elevation) is drawn at that height, with its STEP sides (from 0 to the elevation, outwards, part
*   of the floor's face) all round; the opening strips stay at 0 (doors stay at the level's 0 for now).
* - Walls: prisms on their mitered footprint (wallFootprint), height = wall.height ?? level.wallHeight.
*   Faces: inner, outer, top and the free ends ("edge"); the bottom sits on the floor (not built) and the
*   ends at a joint are inside the neighbour (not built). UVs in meters, anchored to the world along the
*   wall direction, so a pattern continues across collinear walls; never mirrored seen from outside.
*   Openings (doors / windows, planModel.openingRects) are cut through the inner and outer faces; their
*   reveals (jambs, head, sill; a threshold only when no floor fills the opening) belong to the wall's
*   "edge" face.
* - Ceilings (level.ceilings): flat polygons at their height, both faces (from the room and from above, the
*   same face id and material), castShadow: true (the only horizontal faces that shade the room). A PITCHED
*   ceiling (planModel.roofFacets) is one planar facet per eave, both faces; UVs in meters along the eave
*   and up the slope (true lengths, so a pattern is not stretched).
* Face ids: floor.id, ceiling.id, '<wall>:inner' | ':outer' | ':edge'. Every geometry is indexed with position, normal
* and uv, so batches can be merged (roomGeometry.js mergeFaces).
*/
const FLOOR_COLOR = '#d4d4d4'; // plain material colors
const WALL_COLOR = '#ffffff';
const CEILING_COLOR = '#f4f4f4';

const wallHeight = (wall, level) => wall.height ?? level.wallHeight;

// One quad (two triangles) with the given corners (3D, any order around the quad), normal and UVs
function quad(points, normal, uvs) {
    const [p0, p1, p2] = points.map((p) => new Vector3(...p));
    const facing = p1.clone().sub(p0).cross(p2.clone().sub(p0)).dot(new Vector3(...normal));
    const order = facing >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3));
    geometry.setAttribute('normal', new Float32BufferAttribute([normal, normal, normal, normal].flat(), 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs.flat(), 2));
    geometry.setIndex(order);
    return geometry;
}

// A floor polygon at height y, facing up (or down for a ceiling), world-space UVs
export function polygonGeometry(points, y = 0, facingDown = false) {
    const shape = new Shape(points.map(([x, z]) => ({ x, y: facingDown ? z : -z })));
    const geometry = new ShapeGeometry(shape).rotateX(facingDown ? Math.PI / 2 : -Math.PI / 2).translate(0, y, 0);
    return planarUVs(geometry, facingDown ? 'ny' : 'py');
}

/*
* One planar convex polygon (3D points, any winding) as an indexed fan facing `normal`, with UVs from
* uv(point). Used for the facets of pitched ceilings.
*/
function planarPolygon(points, normal, uv) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(points.flatMap(() => normal), 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(points.flatMap(uv), 2));
    const [p0, p1, p2] = points.slice(0, 3).map((p) => new Vector3(...p));
    const facing = p1.clone().sub(p0).cross(p2.clone().sub(p0)).dot(new Vector3(...normal));
    const index = [];
    for (let i = 1; i < points.length - 1; i++) index.push(...(facing >= 0 ? [0, i, i + 1] : [0, i + 1, i]));
    geometry.setIndex(index);
    return geometry;
}

/*
* The exposed beams of a pitched ceiling (planModel.roofBeams): BEAM_SIZE section, top on the roof's
* underside, both ends cut PLUMB (vertical planes): at the ridge, on the vertical plane through the ridge
* line (the two beams of a position meet there, no gap under the ridge); at the eave, on the vertical plane
* through the eave line (nothing juts out past the eave). The bottom edge is the top edge moved down
* (square to the roof) and run on / cut back to those planes. UVs in meters (length along the beam).
*/
// Beams hang this much (meters, straight down) below the roof's underside: no z-fighting between the beam's top
// and the roof (a vertical drop keeps the plumb cuts exactly on the ridge / eave planes)
const BEAM_DROP = 0.005;

/*
* Convex solid `faces` (polygons of [x, y, z]) cut by a plane, keeping the side where (p - point) . normal <= 0;
* the cut is closed by a cap polygon. Used for beams joined at any angle (dormer headers / valleys: clips).
*/
function clipSolid(faces, { point, normal }) {
    const dist = (p) => (p[0] - point[0]) * normal[0] + (p[1] - point[1]) * normal[1] + (p[2] - point[2]) * normal[2];
    const kept = [];
    const cut = [];
    for (const face of faces) {
        const polygon = [];
        face.forEach((a, i) => {
            const b = face[(i + 1) % face.length];
            const [da, db] = [dist(a), dist(b)];
            if (da <= 1e-9) polygon.push(a);
            if (Math.abs(da) <= 1e-9) cut.push(a);
            if ((da < -1e-9 && db > 1e-9) || (da > 1e-9 && db < -1e-9)) {
                const x = a.map((c, j) => c + (b[j] - c) * (da / (da - db)));
                polygon.push(x);
                cut.push(x);
            }
        });
        if (polygon.length >= 3) kept.push(polygon);
    }
    // cap: the points on the plane, in order around their centre
    const unique = cut.filter((p, i) => cut.findIndex((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-7) === i);
    if (unique.length >= 3) {
        const c = [0, 1, 2].map((j) => unique.reduce((sum, p) => sum + p[j], 0) / unique.length);
        const ref = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const u = [normal[1] * ref[2] - normal[2] * ref[1], normal[2] * ref[0] - normal[0] * ref[2], normal[0] * ref[1] - normal[1] * ref[0]];
        const v = [normal[1] * u[2] - normal[2] * u[1], normal[2] * u[0] - normal[0] * u[2], normal[0] * u[1] - normal[1] * u[0]];
        const angle = (p) => Math.atan2((p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1] + (p[2] - c[2]) * v[2], (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1] + (p[2] - c[2]) * u[2]);
        kept.push(unique.sort((p, q) => angle(p) - angle(q)));
    }
    return kept;
}

// A convex solid's faces as geometry: outward normals (away from the solid's centre), UVs in meters in each
// face's plane
function solidGeometry(faces) {
    const all = faces.flat();
    const centre = [0, 1, 2].map((j) => all.reduce((sum, p) => sum + p[j], 0) / all.length);
    return faces.map((face) => {
        let nx = 0, ny = 0, nz = 0;
        face.forEach((p, i) => {
            const q = face[(i + 1) % face.length];
            nx += (p[1] - q[1]) * (p[2] + q[2]);
            ny += (p[2] - q[2]) * (p[0] + q[0]);
            nz += (p[0] - q[0]) * (p[1] + q[1]);
        });
        const length = Math.hypot(nx, ny, nz) || 1;
        let normal = [nx / length, ny / length, nz / length];
        const fc = [0, 1, 2].map((j) => face.reduce((sum, p) => sum + p[j], 0) / face.length);
        if ((fc[0] - centre[0]) * normal[0] + (fc[1] - centre[1]) * normal[1] + (fc[2] - centre[2]) * normal[2] < 0) normal = normal.map((c) => -c);
        const ref = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const u = [ref[1] * normal[2] - ref[2] * normal[1], ref[2] * normal[0] - ref[0] * normal[2], ref[0] * normal[1] - ref[1] * normal[0]];
        const ul = Math.hypot(...u) || 1;
        const uu = u.map((c) => c / ul);
        const vv = [normal[1] * uu[2] - normal[2] * uu[1], normal[2] * uu[0] - normal[0] * uu[2], normal[0] * uu[1] - normal[1] * uu[0]];
        return planarPolygon(face, normal, (p) => [p[0] * uu[0] + p[1] * uu[1] + p[2] * uu[2], p[0] * vv[0] + p[1] * vv[1] + p[2] * vv[2]]);
    });
}

function beamsGeometry(beams) {
    return mergeGeometries(beams.flatMap(({ top: [ridgeTop, eaveTop], across, down, depth, width = BEAM_SIZE.width, clips = [] }) => {
        const [r, e] = [ridgeTop, eaveTop].map(([x, y, z]) => [x, y - BEAM_DROP, z]);
        const along = [0, 1, 2].map((c) => e[c] - r[c]);
        const run = Math.hypot(along[0], along[2]);             // plan length ridge -> eave
        const plan = [along[0] / run, 0, along[2] / run];        // plan direction ridge -> eave
        // bottom edge: top edge + down x depth, at the parameters where its plan position is the ridge / eave
        const shift = (down[0] * plan[0] + down[2] * plan[2]) * depth / run;
        const bottom = (s) => [0, 1, 2].map((c) => r[c] + down[c] * depth + along[c] * s);
        const [b0, b1] = [bottom(-shift), bottom(1 - shift)];
        const side = (p, s) => [0, 1, 2].map((c) => p[c] + across[c] * s * width / 2);
        const length = Math.hypot(...along);
        const up = down.map((c) => -c);
        const faces = [
            // [corners, normal, uvs]: top, bottom, the two sides, the plumb ends (ridge, eave)
            [[side(r, -1), side(e, -1), side(e, 1), side(r, 1)], up, [[0, 0], [length, 0], [length, width], [0, width]]],
            [[side(b0, -1), side(b1, -1), side(b1, 1), side(b0, 1)], down, [[0, 0], [length, 0], [length, width], [0, width]]],
            [[side(r, -1), side(e, -1), side(b1, -1), side(b0, -1)], across.map((c) => -c), [[0, depth], [length, depth], [length, 0], [0, 0]]],
            [[side(r, 1), side(e, 1), side(b1, 1), side(b0, 1)], across, [[0, depth], [length, depth], [length, 0], [0, 0]]],
            [[side(r, -1), side(r, 1), side(b0, 1), side(b0, -1)], plan.map((c) => -c), [[0, depth], [width, depth], [width, 0], [0, 0]]],
            [[side(e, -1), side(e, 1), side(b1, 1), side(b1, -1)], plan, [[0, depth], [width, depth], [width, 0], [0, 0]]]
        ];
        // beams joined at an angle (clips): the box cut by those planes, as a convex solid
        if (clips.length > 0) {
            let solid = faces.map(([points]) => points);
            for (const clip of clips) solid = clipSolid(solid, clip);
            return solid.length >= 4 ? solidGeometry(solid) : [];
        }
        return faces.map(([points, normal, uvs]) => quad(points, normal, uvs));
    }));
}

// The holes the dormers cut in their facets: { eave index: [plan outline] } (planModel.dormerFootprint)
function dormerHoles(ceiling, level) {
    const holes = {};
    for (const dormer of roofDormers(ceiling, level)) {
        const outline = dormerFootprint(ceiling, level, dormer);
        if (outline) (holes[dormer.eave] ??= []).push(outline);
    }
    return holes;
}

// Vertical planar polygons (dormer walls): both faces (outside and inside), UVs in meters (horizontal along
// the wall, height)
function verticalWallsGeometry(walls) {
    return mergeGeometries(walls.flatMap(({ normal, along, points }) => {
        const uv = (p) => [p[0] * along[0] + p[2] * along[2], p[1]];
        return [planarPolygon(points, normal, uv), planarPolygon(points, normal.map((c) => -c), uv)];
    }));
}

// A pitched ceiling's facets (planModel.roofFacets), each with its underside (the room's side) and top
// HOLES (dormers: holesByEdge[eave] = plan outlines [[x, z]]) are cut out of the facet of that eave: the
// facet is triangulated in plan with its holes (earcut, ShapeUtils) and every point lifted onto its plane.
function roofGeometry(facets, holesByEdge = {}) {
    return mergeGeometries(facets.flatMap(({ dir, points, edge }) => {
        const up = facetNormal(points);
        // UVs in the facet's plane, true lengths: u along the eave, v = up x u (up the slope)
        const u = [dir[0], 0, dir[1]];
        const v = [up[1] * u[2] - up[2] * u[1], up[2] * u[0] - up[0] * u[2], up[0] * u[1] - up[1] * u[0]];
        const uv = (p) => [p[0] * u[0] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]];
        const holes = holesByEdge[edge] ?? [];
        if (holes.length === 0) return [planarPolygon(points, up.map((c) => -c), uv), planarPolygon(points, up, uv)];
        // the plane's height at a plan point
        const [x0, y0, z0] = points[0];
        const lift = ([x, z]) => [x, y0 - (up[0] * (x - x0) + up[2] * (z - z0)) / up[1], z];
        const ring = points.map((p) => [p[0], p[2]]);
        const all = [...ring, ...holes.flat()].map(lift);
        const triangles = ShapeUtils.triangulateShape(ring.map(([x, z]) => new Vector2(x, z)), holes.map((hole) => hole.map(([x, z]) => new Vector2(x, z))));
        return [-1, 1].map((side) => {
            const normal = up.map((c) => side * c);
            const index = triangles.flatMap(([a, b, c]) => {
                const [pa, pb, pc] = [all[a], all[b], all[c]].map((p) => new Vector3(...p));
                const facing = pb.clone().sub(pa).cross(pc.clone().sub(pa)).dot(new Vector3(...normal));
                return facing >= 0 ? [a, b, c] : [a, c, b];
            });
            const geometry = new BufferGeometry();
            geometry.setAttribute('position', new Float32BufferAttribute(all.flat(), 3));
            geometry.setAttribute('normal', new Float32BufferAttribute(all.flatMap(() => normal), 3));
            geometry.setAttribute('uv', new Float32BufferAttribute(all.flatMap(uv), 2));
            geometry.setIndex(index);
            return geometry;
        });
    }));
}

/*
* The vertical sides of a floor polygon raised (or lowered) by `elevation`: one quad per edge from 0 to the
* elevation, facing outwards; UVs in meters (along the edge, up), so a pattern looks like the floor's.
* ponytail: sides are built all round, also where a wall covers them (hidden inside it: no visible harm);
* the bill of quantities does not count them yet.
*/
function stepSides(points, elevation) {
    const [y0, y1] = elevation > 0 ? [0, elevation] : [elevation, 0];
    let run = 0;
    return points.map((p, i) => {
        const q = points[(i + 1) % points.length];
        const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
        // outward normal: the edge's perpendicular whose side does not hold the polygon
        let normal = [(q[1] - p[1]) / length, 0, -(q[0] - p[0]) / length];
        const probe = [(p[0] + q[0]) / 2 + normal[0] * 1e-4, (p[1] + q[1]) / 2 + normal[2] * 1e-4];
        if (pointInPolygon(probe, points)) normal = normal.map((v) => -v);
        const u0 = run, u1 = (run += length);
        return quad([[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]], normal, [[u0, y0], [u1, y0], [u1, y1], [u0, y1]]);
    }); // no zero-length edges: planModel.floorPolygon drops consecutive duplicates
}

/*
* WALLS UNDER A PITCHED ROOF (3c): where a wall's face runs under a pitched ceiling (planModel roofFacets),
* its TOP follows the roof's underside instead of the wall height: lower where the roof comes down (eaves),
* higher where it goes up (gables close by themselves, partitions reach the roof). Elsewhere: the wall height.
* wallTops(wall, level, roofs).profile(t0, t1, offset) = the face's top as straight SEGMENTS along the line
* [{ t0, t1, y0, y1 }]: cut where the face crosses a facet's edge or a roof's outline (the roof is planar in
* between); a stretch is under a roof when its MIDDLE is (the lowest roof wins if they overlap). Under a
* DORMER (its footprint: the hole in the main roof) the top follows the dormer's roof instead (planModel
* dormerAt): its cheek lines make a vertical step, its ridge a peak (also cut points).
* ponytail: an opening taller than the roof over it is not cut by the roof.
*/
// the pitched ceilings of a level with the plan edges where a wall's top can change slope
function pitchedRoofs(level) {
    const edgesOf = (points) => points.map((p, i) => [p, points[(i + 1) % points.length]]);
    return (level.ceilings ?? []).filter((ceiling) => roofEaves(ceiling).length > 0).map((ceiling) => ({
        ceiling,
        edges: [
            ...edgesOf(ceiling.points),
            ...(roofFacets(ceiling, level) ?? []).flatMap((facet) => edgesOf(facet.points.map((p) => [p[0], p[2]]))),
            // dormers: their footprint's outline and their ridge
            ...roofDormers(ceiling, level).flatMap((dormer) => {
                const footprint = dormerFootprint(ceiling, level, dormer);
                return footprint ? [...edgesOf(footprint), dormerLines(ceiling, level, dormer).ridge] : [];
            })
        ]
    }));
}
// where segment p0 -> p1 crosses segment q0 -> q1: the parameter along p (0..1), or null
function crossing(p0, p1, q0, q1) {
    const d = [p1[0] - p0[0], p1[1] - p0[1]], e = [q1[0] - q0[0], q1[1] - q0[1]];
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-12) return null;
    const w = [q0[0] - p0[0], q0[1] - p0[1]];
    const s = (w[0] * e[1] - w[1] * e[0]) / den, u = (w[0] * d[1] - w[1] * d[0]) / den;
    return s > 1e-9 && s < 1 - 1e-9 && u > -1e-9 && u < 1 + 1e-9 ? s : null;
}
function wallTops(wall, level, roofs) {
    const h = wallHeight(wall, level);
    const { dir, normal } = wallFrame(wall);
    const plan = (t, offset) => [wall.a[0] + dir[0] * t + normal[0] * offset, wall.a[1] + dir[1] * t + normal[1] * offset];
    // the roof surface over a plan point: a height function (the lowest pitched ceiling's roof, or the roof of
    // its dormer there), or null when no pitched ceiling covers it
    const roofOver = (p) => {
        let best = null;
        for (const { ceiling } of roofs) {
            if (!pointInPolygon(p, ceiling.points)) continue;
            const dormer = dormerAt(ceiling, level, p);
            const heightAt = dormer ? dormer.heightAt : (q) => roofHeightAt(ceiling, level, q);
            const y = heightAt(p);
            if (best === null || y < best.y) best = { heightAt, y };
        }
        return best?.heightAt ?? null;
    };
    const { inner: innerOffset, outer: outerOffset } = faceOffsets(wall);
    const axisOffset = (innerOffset + outerOffset) / 2;
    const profile = (t0, t1, offset) => {
        if (roofs.length === 0 || t1 - t0 < 1e-9) return [{ t0, t1, y0: h, y1: h }];
        const p0 = plan(t0, offset), p1 = plan(t1, offset);
        const ts = [t0, t1];
        for (const { edges } of roofs) for (const [q0, q1] of edges) {
            const s = crossing(p0, p1, q0, q1);
            if (s !== null) ts.push(t0 + (t1 - t0) * s);
        }
        const cuts = [...new Set(ts.map((t) => Math.round(t * 1e7) / 1e7))].sort((x, y) => x - y);
        const segments = [];
        for (let i = 1; i < cuts.length; i++) {
            const [ta, tb] = [cuts[i - 1], cuts[i]];
            if (tb - ta < 1e-7) continue;
            // the region is read a hair INSIDE the wall (towards its axis), not on the face itself: a face lying
            // exactly on a region's edge (a dormer cheek snapped onto a wall face) belongs to the wall's side
            // (24/10: the wall rose to the dormer's eave there, doubling its cheek)
            const towardsAxis = Math.sign(axisOffset - offset) * 1e-4;
            const surface = roofOver(plan((ta + tb) / 2, offset + towardsAxis));
            const yAt = (t) => (surface ? surface(plan(t, offset)) : h);
            segments.push({ t0: ta, t1: tb, y0: yAt(ta), y1: yAt(tb) });
        }
        return segments.length > 0 ? segments : [{ t0, t1, y0: h, y1: h }];
    };
    // true when the wall's middle (its line) is under a pitched roof
    const isCovered = () => roofOver(plan(Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) / 2, 0)) !== null;
    // the top's height function over a plan point's region (the roof there, or the flat wall height)
    const surfaceAt = (p) => roofOver(p) ?? (() => h);
    return { profile, isCovered, surfaceAt };
}

// Convex polygon `points` split by the infinite line through q0 -> q1: [left part, right part] (either may be
// empty, < 3 points)
function splitByLine(points, q0, q1) {
    const d = [q1[0] - q0[0], q1[1] - q0[1]];
    const side = (p) => d[0] * (p[1] - q0[1]) - d[1] * (p[0] - q0[0]);
    const halves = [[], []];
    points.forEach((a, i) => {
        const b = points[(i + 1) % points.length];
        const [sa, sb] = [side(a), side(b)];
        if (sa >= -1e-9) halves[0].push(a);
        if (sa <= 1e-9) halves[1].push(a);
        if ((sa > 1e-9 && sb < -1e-9) || (sa < -1e-9 && sb > 1e-9)) {
            const t = sa / (sa - sb);
            const x = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            halves[0].push(x);
            halves[1].push(x);
        }
    });
    return halves;
}

/*
* The TOP of a wall under a roof, exact: its plan outline (the footprint quad) is cut along every roof line
* (facet edges, roof outlines, dormer footprints and ridges: pitchedRoofs edges, as infinite lines), so each
* piece lies on ONE planar region and is lifted onto it (no twisted quads). Where two neighbouring pieces sit at
* different heights (a dormer's cheek: a vertical step), a vertical RISER joins them, built on the lower side.
* Returns the geometries (each piece / riser one quad or fan), or [] when there is nothing to build.
*/
function roofCapGeometries(footprint, tops, roofs, along, across) {
    const lines = roofs.flatMap((roof) => roof.edges);
    let pieces = [footprint];
    for (const [q0, q1] of lines) {
        pieces = pieces.flatMap((piece) => splitByLine(piece, q0, q1).filter((part) => part.length >= 3 && Math.abs(polygonArea(part)) > 1e-8));
    }
    const centroid = (piece) => [piece.reduce((sum, p) => sum + p[0], 0) / piece.length, piece.reduce((sum, p) => sum + p[1], 0) / piece.length];
    const geometries = [];
    for (const piece of pieces) {
        const surface = tops.surfaceAt(centroid(piece));
        const lifted = piece.map((p) => [p[0], surface(p), p[1]]);
        geometries.push(planarPolygon(lifted, [0, 1, 0], (q) => [along([q[0], q[2]]), across([q[0], q[2]])]));
        // risers: along each edge of this piece, up to a HIGHER neighbouring region (sampled just across the edge,
        // inside the footprint)
        const c = centroid(piece);
        piece.forEach((p, i) => {
            const q = piece[(i + 1) % piece.length];
            const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
            const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (length < 1e-6) return;
            let out = [(q[1] - p[1]) / length, -(q[0] - p[0]) / length];
            if ((mid[0] - c[0]) * out[0] + (mid[1] - c[1]) * out[1] < 0) out = [-out[0], -out[1]];
            const across1 = [mid[0] + out[0] * 1e-4, mid[1] + out[1] * 1e-4];
            if (!pointInPolygon(across1, footprint)) return; // the footprint's outline: the faces close it
            const other = tops.surfaceAt(across1);
            const [low0, low1, high0, high1] = [surface(p), surface(q), other(p), other(q)];
            if (high0 - low0 < 1e-4 && high1 - low1 < 1e-4) return;
            geometries.push(quad([[p[0], low0, p[1]], [q[0], low1, q[1]], [q[0], Math.max(low1, high1), q[1]], [p[0], Math.max(low0, high0), p[1]]],
                [-out[0], 0, -out[1]], [[0, low0], [length, low1], [length, high1], [0, high0]]));
        });
    }
    return geometries;
}
// The top height at t from a profile. `within` (optional): a point INSIDE the stretch the height is wanted
// for: at a break between two segments (e.g. a dormer's cheek: main roof on one side, dormer eave on the other)
// both are valid and the top has a vertical step, so the segment must be picked by the stretch, not by t.
const topAt = (segments, t, within = t) => {
    const seg = segments.find((s) => within >= s.t0 - 1e-7 && within <= s.t1 + 1e-7) ?? (within < segments[0].t0 ? segments[0] : segments[segments.length - 1]);
    const k = seg.t1 - seg.t0 > 1e-9 ? (t - seg.t0) / (seg.t1 - seg.t0) : 0;
    return seg.y0 + (seg.y1 - seg.y0) * k;
};
// area under a profile (the face without its openings)
const profileArea = (segments) => segments.reduce((sum, s) => sum + (s.t1 - s.t0) * (s.y0 + s.y1) / 2, 0);

/*
* One face of a wall with the openings cut out, as columns of quads between the openings' sides and the
* top's breaks (no triangulation, exact UVs). t0 / t1: the face's extent along the drawn line (from `a`);
* tops: its top profile (wallTops: the wall height, or the roof over it); point(t, y) / uv(t, y): 3D point and
* UV of the face at (t, y). Openings never overlap (addOpening).
*/
function holedFace(t0, t1, tops, rects, point, normal, uv) {
    const breaks = tops.flatMap((s) => [s.t0, s.t1]);
    const cuts = [...new Set([t0, t1, ...[...rects.flatMap((r) => [r.from, r.to]), ...breaks].filter((t) => t > t0 && t < t1)])].sort((p, q) => p - q);
    const quads = [];
    for (let i = 1; i < cuts.length; i++) {
        const ta = cuts[i - 1], tb = cuts[i];
        if (tb - ta < 1e-6) continue;
        const hole = rects.find((r) => r.from < (ta + tb) / 2 && r.to > (ta + tb) / 2);
        // this column's own stretch (its middle): a vertical step at a break stays a step
        const middle = (ta + tb) / 2;
        const [topA, topB] = [topAt(tops, ta, middle), topAt(tops, tb, middle)];
        // solid parts of this column: [bottom, top at ta, top at tb]
        const spans = hole ? [[0, hole.bottom, hole.bottom], [hole.top, topA, topB]] : [[0, topA, topB]];
        for (const [y0, y1a, y1b] of spans) {
            if (y1a - y0 < 1e-6 && y1b - y0 < 1e-6) continue;
            const corners = [[ta, y0], [tb, y0], [tb, Math.max(y0, y1b)], [ta, Math.max(y0, y1a)]];
            quads.push(quad(corners.map(([t, y]) => point(t, y)), normal, corners.map(([t, y]) => uv(t, y))));
        }
    }
    // a face with no length (a wall shorter than its joints take: t1 <= t0) has nothing to draw: null, the
    // caller drops it (mergeGeometries([]) would throw and stop the whole room)
    if (quads.length === 0) return null;
    return quads.length === 1 ? quads[0] : mergeGeometries(quads);
}

// The faces of one wall: [{ part: 'inner' | 'outer' | 'edge', geometry, vertical }]
// filled: ids of this wall's openings whose depth a floor fills (openingFloors): no threshold built there
function wallGeometries(wall, level, filled, roofs = pitchedRoofs(level)) {
    const h = wallHeight(wall, level);
    const tops = wallTops(wall, level, roofs);
    const { dir, normal } = wallFrame(wall);
    const { a, b, aOut, bOut, aJoined, bJoined } = wallFootprint(wall, level.walls);
    const offsets = faceOffsets(wall);
    const rects = openingRects(wall, h);
    const at = (p, y) => [p[0], y, p[1]];
    const along = (p) => p[0] * dir[0] + p[1] * dir[1];     // world-anchored coordinate along the wall
    const across = (p) => p[0] * normal[0] + p[1] * normal[1];
    const lineT = (p) => (p[0] - wall.a[0]) * dir[0] + (p[1] - wall.a[1]) * dir[1]; // distance from `a` along the line
    // 3D point at distance t along the line, `offset` from it along the normal (a face), height y
    const onLine = (t, offset, y) => [wall.a[0] + dir[0] * t + normal[0] * offset, y, wall.a[1] + dir[1] * t + normal[1] * offset];
    const along0 = along(wall.a), across0 = across(wall.a);
    const inward = [-normal[0], 0, -normal[1]];
    const innerTops = tops.profile(lineT(a), lineT(b), offsets.inner);
    const outerTops = tops.profile(lineT(aOut), lineT(bOut), offsets.outer);
    const faces = [
        { part: 'inner', vertical: true, geometry: holedFace(lineT(a), lineT(b), innerTops, rects,
            (t, y) => onLine(t, offsets.inner, y), inward, (t, y) => [along0 + t, y]) },
        { part: 'outer', vertical: true, geometry: holedFace(lineT(aOut), lineT(bOut), outerTops, rects,
            (t, y) => onLine(t, offsets.outer, y), [normal[0], 0, normal[1]], (t, y) => [-(along0 + t), y]) }
    ];
    // the top cap: flat at the wall height. Under a roof it follows the roof exactly (roofCapGeometries: pieces
    // cut along the roof's lines, risers at the steps) and is drawn only while the ceilings are HIDDEN (onlyWithoutRoof, Room.jsx): with
    // the roof shown it would lie on the roof's plane (z-fighting) and nothing of it is seen anyway.
    if (!tops.isCovered()) faces.push({ part: 'edge', vertical: false, geometry: quad([at(a, h), at(b, h), at(bOut, h), at(aOut, h)], [0, 1, 0],
        [a, b, bOut, aOut].map((p) => [along(p), across(p)])) });
    else {
        const caps = roofCapGeometries([a, b, bOut, aOut], tops, roofs, along, across);
        if (caps.length > 0) faces.push({ part: 'edge', vertical: false, onlyWithoutRoof: true, geometry: caps.length === 1 ? caps[0] : mergeGeometries(caps) });
    }
    // free ends: up to each face's own top there
    const [ha, haOut] = [topAt(innerTops, lineT(a)), topAt(outerTops, lineT(aOut))];
    const [hb, hbOut] = [topAt(innerTops, lineT(b)), topAt(outerTops, lineT(bOut))];
    if (!aJoined) faces.push({ part: 'edge', vertical: true, geometry: quad([at(a, 0), at(aOut, 0), at(aOut, haOut), at(a, ha)], [-dir[0], 0, -dir[1]],
        [[across(a), 0], [across(aOut), 0], [across(aOut), haOut], [across(a), ha]]) });
    if (!bJoined) faces.push({ part: 'edge', vertical: true, geometry: quad([at(b, 0), at(bOut, 0), at(bOut, hbOut), at(b, hb)], [dir[0], 0, dir[1]],
        [[-across(b), 0], [-across(bOut), 0], [-across(bOut), hbOut], [-across(b), hb]]) });
    // Reveals of each opening, through the wall's thickness: jambs facing into the opening, head facing
    // down, sill (window) / threshold (door) facing up
    const { inner: fi, outer: fo } = offsets;
    for (const { opening, from, to, bottom, top } of rects) {
        const jamb = (t, sign) => quad([onLine(t, fi, bottom), onLine(t, fo, bottom), onLine(t, fo, top), onLine(t, fi, top)],
            [dir[0] * sign, 0, dir[1] * sign], [[across0 + fi, bottom], [across0 + fo, bottom], [across0 + fo, top], [across0 + fi, top]]);
        const flat = (y, up) => quad([onLine(from, fi, y), onLine(to, fi, y), onLine(to, fo, y), onLine(from, fo, y)],
            [0, up, 0], [[along0 + from, across0 + fi], [along0 + to, across0 + fi], [along0 + to, across0 + fo], [along0 + from, across0 + fo]]);
        faces.push(
            { part: 'edge', vertical: true, geometry: jamb(from, 1) },
            { part: 'edge', vertical: true, geometry: jamb(to, -1) },
            { part: 'edge', vertical: false, geometry: flat(top, -1) }
        );
        if (!filled.has(opening.id)) faces.push({ part: 'edge', vertical: false, geometry: flat(bottom, 1) });
    }
    return faces.filter((face) => face.geometry != null); // degenerate faces (holedFace null) are skipped
}

/*
* Every visible face of a level: { key, geometry, surfaceId, vertical, color, castShadow?, onlyWithoutRoof? }
* (onlyWithoutRoof: a wall's top under a pitched roof, shown only while the ceilings are hidden).
*/
export function roomFaces(level) {
    const roofs = pitchedRoofs(level); // walls under them follow them (wallTops)
    const patches = openingFloors(level);
    const filled = new Set(patches.map((patch) => patch.openingId));
    return [
        ...level.floors.map((floor) => {
            const strips = patches.filter((patch) => patch.floorId === floor.id).map((patch) => polygonGeometry(patch.points));
            const elevation = floorElevation(floor);
            const sides = Math.abs(elevation) > 1e-6 ? stepSides(floor.points, elevation) : [];
            const parts = [polygonGeometry(floor.points, elevation), ...strips, ...sides];
            const geometry = parts.length > 1 ? mergeGeometries(parts) : parts[0];
            return { key: floor.id, geometry, surfaceId: floor.id, vertical: false, color: FLOOR_COLOR };
        }),
        ...(level.ceilings ?? []).map((ceiling) => {
            const height = ceilingHeight(ceiling, level);
            const facets = roofFacets(ceiling, level);
            // dormers: their small roofs are part of the ceiling's surface (same material)
            const dormerRoofs = roofDormers(ceiling, level).flatMap((dormer) => dormerSolids(ceiling, level, dormer)?.roofs ?? []);
            return {
                key: ceiling.id,
                // underside (the room's side) + top (seen from above), coplanar, back faces culled
                geometry: facets ? roofGeometry([...facets, ...dormerRoofs], dormerHoles(ceiling, level))
                    : mergeGeometries([polygonGeometry(ceiling.points, height, true), polygonGeometry(ceiling.points, height)]),
                surfaceId: ceiling.id,
                vertical: false,
                castShadow: true,
                color: CEILING_COLOR
            };
        }),
        // dormer walls (fronts, cheeks): a surface of their own, like walls
        ...(level.ceilings ?? []).flatMap((ceiling) => {
            const walls = roofDormers(ceiling, level).flatMap((dormer) => dormerSolids(ceiling, level, dormer)?.walls ?? []);
            return walls.length === 0 ? [] : [{
                key: dormerWallsFaceId(ceiling.id),
                geometry: verticalWallsGeometry(walls),
                surfaceId: dormerWallsFaceId(ceiling.id),
                vertical: true,
                color: WALL_COLOR
            }];
        }),
        // exposed beams: their own face id (a material of their own, e.g. wood), cast shadows; the dormers'
        // beams with them
        ...(level.ceilings ?? []).flatMap((ceiling) => {
            const rafters = roofBeams(ceiling, level);
            const beams = [...rafters, ...dormerBeams(ceiling, level, rafters)];
            return beams.length === 0 ? [] : [{
                key: beamsFaceId(ceiling.id),
                geometry: beamsGeometry(beams),
                surfaceId: beamsFaceId(ceiling.id),
                vertical: false,
                castShadow: true,
                color: CEILING_COLOR
            }];
        }),
        ...level.walls.flatMap((wall) => wallGeometries(wall, level, filled, roofs).map((face, index) => ({
            key: `${wall.id}-${face.part}-${index}`,
            geometry: face.geometry,
            surfaceId: `${wall.id}:${face.part}`,
            vertical: face.vertical,
            // a wall top under a roof: drawn only while the ceilings are hidden (Room.jsx)
            ...(face.onlyWithoutRoof ? { onlyWithoutRoof: true } : {}),
            color: WALL_COLOR
        })))
    ];
}

/*
* Area of every face id of a level: { surfaceId: m² }, from the plan data (no geometry): floor polygons;
* inner face = inner line x height (exactly the side the room sees); outer = outer line x height; edge =
* top (footprint) + free ends + opening reveals (no threshold where a floor fills the opening: that strip
* counts for the floor). Openings are subtracted from the inner / outer faces
* (the part of each opening within that face). Rounded to cm².
*/
export function surfaceAreas(level) {
    const areas = {};
    const put = (id, value) => { areas[id] = Math.round(((areas[id] ?? 0) + value) * 100) / 100; };
    for (const floor of level.floors) put(floor.id, polygonArea(floor.points));
    // ceilings: a pitched one counts its true sloped area (plan area x sqrt(1 + slope²))
    for (const ceiling of level.ceilings ?? []) {
        const facets = roofFacets(ceiling, level);
        put(ceiling.id, facets ? facets.reduce((sum, facet) => sum + facetArea(facet.points), 0) : polygonArea(ceiling.points));
        // dormers: their small roofs count with the ceiling, their walls on their own (outside face)
        for (const dormer of roofDormers(ceiling, level)) {
            const solids = dormerSolids(ceiling, level, dormer);
            if (!solids) continue;
            put(ceiling.id, solids.roofs.reduce((sum, roof) => sum + facetArea(roof.points), 0));
            // minus the hole it cuts in the main facet (its outline lifted onto the main roof)
            put(ceiling.id, -facetArea(dormerFootprint(ceiling, level, dormer).map(([x, z]) => [x, roofHeightAt(ceiling, level, [x, z]), z])));
            put(dormerWallsFaceId(ceiling.id), solids.walls.reduce((sum, wall) => sum + facetArea(wall.points), 0));
        }
        // beams: their visible surface (bottom + two sides + ends; the top is against the roof)
        const rafters = roofBeams(ceiling, level);
        const beams = [...rafters, ...dormerBeams(ceiling, level, rafters)];
        if (beams.length > 0) put(beamsFaceId(ceiling.id), beams.reduce((sum, { top: [r, e], depth, width = BEAM_SIZE.width }) => sum + Math.hypot(e[0] - r[0], e[1] - r[1], e[2] - r[2]) * (width + 2 * depth) + 2 * width * depth, 0));
    }
    const patches = openingFloors(level);
    for (const patch of patches) put(patch.floorId, polygonArea(patch.points));
    const filled = new Set(patches.map((patch) => patch.openingId));
    const roofs = pitchedRoofs(level);
    for (const wall of level.walls) {
        const h = wallHeight(wall, level);
        const tops = wallTops(wall, level, roofs);
        const { inner: fi, outer: fo } = faceOffsets(wall);
        const f = wallFootprint(wall, level.walls);
        const length = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
        const { dir } = wallFrame(wall);
        const lineT = (p) => (p[0] - wall.a[0]) * dir[0] + (p[1] - wall.a[1]) * dir[1];
        const rects = openingRects(wall, h);
        // area of the openings within a face spanning t0..t1 along the line
        const holes = (t0, t1) => rects.reduce((sum, r) => sum + Math.max(0, Math.min(r.to, t1) - Math.max(r.from, t0)) * (r.top - r.bottom), 0);
        // jambs + head, and the threshold unless a floor fills the opening
        const reveals = rects.reduce((sum, r) => sum + (2 * (r.top - r.bottom) + (filled.has(r.opening.id) ? 1 : 2) * (r.to - r.from)) * wall.thickness, 0);
        // faces: the area under their top profile (the wall height, or the roof over them: wallTops)
        const innerTops = tops.profile(lineT(f.a), lineT(f.b), fi);
        const outerTops = tops.profile(lineT(f.aOut), lineT(f.bOut), fo);
        put(`${wall.id}:inner`, profileArea(innerTops) - holes(lineT(f.a), lineT(f.b)));
        put(`${wall.id}:outer`, profileArea(outerTops) - holes(lineT(f.aOut), lineT(f.bOut)));
        // free ends: trapezoids up to each face's top; no top cap under a roof
        const end = (p, pOut, hp, hpOut) => length(p, pOut) * (hp + hpOut) / 2;
        put(`${wall.id}:edge`, (tops.isCovered() ? 0 : polygonArea([f.a, f.b, f.bOut, f.aOut]))
            + (f.aJoined ? 0 : end(f.a, f.aOut, topAt(innerTops, lineT(f.a)), topAt(outerTops, lineT(f.aOut))))
            + (f.bJoined ? 0 : end(f.b, f.bOut, topAt(innerTops, lineT(f.b)), topAt(outerTops, lineT(f.bOut)))) + reveals);
    }
    return areas;
}

// Human name of a face id, e.g. 'wall-left:inner' -> 'Left wall · inside' (walls without a name: "Wall 3")
export function surfaceLabel(surfaceId, level) {
    const floorIndex = level.floors.findIndex((floor) => floor.id === surfaceId);
    if (floorIndex >= 0) return level.floors.length > 1 ? `Floor ${floorIndex + 1}` : 'Floor';
    const ceilings = level.ceilings ?? [];
    const ceilingIndex = ceilings.findIndex((ceiling) => ceiling.id === surfaceId);
    if (ceilingIndex >= 0) return ceilings.length > 1 ? `Ceiling ${ceilingIndex + 1}` : 'Ceiling';
    const dormerIndex = ceilings.findIndex((ceiling) => dormerWallsFaceId(ceiling.id) === surfaceId);
    if (dormerIndex >= 0) return ceilings.length > 1 ? `Ceiling ${dormerIndex + 1} · dormer walls` : 'Ceiling · dormer walls';
    const beamsIndex = ceilings.findIndex((ceiling) => beamsFaceId(ceiling.id) === surfaceId);
    if (beamsIndex >= 0) return ceilings.length > 1 ? `Ceiling ${beamsIndex + 1} · beams` : 'Ceiling · beams';
    const [wallId, side] = surfaceId.split(':');
    const index = level.walls.findIndex((wall) => wall.id === wallId);
    const name = level.walls[index]?.name ?? (index >= 0 ? `Wall ${index + 1}` : 'Removed wall');
    const sides = { inner: 'inside', outer: 'outside', edge: 'top & ends' };
    return `${name} · ${sides[side] ?? side}`;
}
