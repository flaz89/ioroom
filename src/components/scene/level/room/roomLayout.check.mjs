// Check for roomLayout.js: node src/components/scene/level/room/roomLayout.check.mjs
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { roomFaces, surfaceAreas, surfaceLabel } from './roomLayout.js';
import { DEFAULT_PLAN, activeLevel, pointInPolygon, addFloor, addOpening, fillRoom, roofFacets, roofHeightAt, addDormer, addRoofHole, setWallParapet, dormerFootprint, polygonArea, moveRoofHoleVertex, removeRoofHole, roofHoleAt, roofHoleFacets, roofHoleTargets, roofHoles, dormerBeams, dormerLines, dormerSolids, dragDormer, removeDormer, roofDormers, updateDormer, dormerOnHips, roofBeams, roofRidge, roofType, setRoofBeams, setRoofRidge, rotateRoof, setCeilingHeight, setCeilingRoof, setFloorElevation, roofPitch, setRoofRidgeHeight, wallFrame, faceOffsets, setCeilingThickness, ceilingThickness } from '../../../../plan/planModel.js';

const level = activeLevel(DEFAULT_PLAN);
const areas = surfaceAreas(level);
const near = (a, b) => Math.abs(a - b) < 0.011;
assert.ok(near(areas.floor, 36));
// inside faces: exactly what the room sees
assert.ok(near(areas['wall-back:inner'], 6 * 2.7) && near(areas['wall-left:inner'], 6 * 2.7));
// outside of the back wall: mitered at both corners, 6.30 m long
assert.ok(near(areas['wall-back:outer'], 6.3 * 2.7), `${areas['wall-back:outer']}`);
// left wall edge: top trapezoid (6.15 + 6) / 2 x 0.15 + its open end 0.15 x 2.7
assert.ok(near(areas['wall-left:edge'], (6.15 + 6) / 2 * 0.15 + 0.15 * 2.7), `${areas['wall-left:edge']}`);
// a window (1.2 x 1.4) and a door (0.9 x 2.1) on the back wall (0.15 thick): holes off both faces, reveals on the edge
const holed = addOpening(addOpening(level, 'wall-back', 'window', 'o1'), 'wall-back', 'door', 'o2');
const holedAreas = surfaceAreas(holed);
const holes = 1.2 * 1.4 + 0.9 * 2.1;
assert.ok(near(holedAreas['wall-back:inner'], 6 * 2.7 - holes), `${holedAreas['wall-back:inner']}`);
assert.ok(near(holedAreas['wall-back:outer'], 6.3 * 2.7 - holes));
// reveals: window jambs + head + sill, door jambs + head (no threshold: the room's floor fills the door's depth)
assert.ok(near(holedAreas['wall-back:edge'] - areas['wall-back:edge'], (2 * (1.4 + 1.2) + 2 * 2.1 + 0.9) * 0.15));
assert.ok(near(holedAreas.floor, 36 + 0.9 * 0.15), `${holedAreas.floor}`);
// the floor's geometry has the strip: it reaches the back wall's outer face (z = -3.15) under the door
const holedFloor = roomFaces(holed).find((face) => face.surfaceId === 'floor').geometry;
holedFloor.computeBoundingBox();
assert.ok(Math.abs(holedFloor.boundingBox.min.z + 3.15) < 1e-6, `${holedFloor.boundingBox.min.z}`);
// floorSide 'out' with no floor outside: the room's floor still fills it (nothing else could)
const outside = { ...holed, walls: holed.walls.map((w) => (w.id === 'wall-back' ? { ...w, openings: w.openings.map((o) => ({ ...o, floorSide: 'out' })) } : w)) };
assert.ok(near(surfaceAreas(outside).floor, 36 + 0.9 * 0.15));
// no floor on either side (no floors at all): the threshold is back
const bare = surfaceAreas({ ...holed, floors: [] });
assert.ok(near(bare['wall-back:edge'] - areas['wall-back:edge'], 2 * (1.4 + 1.2 + 2.1 + 0.9) * 0.15));
// every face: normal attribute agrees with the triangle winding (front faces outwards / inwards as declared)
for (const face of [...roomFaces(level), ...roomFaces(holed)]) {
    const { position, normal } = face.geometry.attributes;
    const index = face.geometry.index;
    for (let t = 0; t < index.count; t += 3) {
        const p = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(position, index.getX(t + k)));
        const winding = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));
        assert.ok(winding.dot(new Vector3().fromBufferAttribute(normal, index.getX(t))) > 0, `${face.key} winding`);
    }
    assert.ok(face.geometry.attributes.uv != null && index != null, `${face.key} attributes`);
}
// the back wall inner face faces the room (+z) and its UVs run in meters along x
const inner = roomFaces(level).find((face) => face.surfaceId === 'wall-back:inner');
assert.ok(new Vector3().fromBufferAttribute(inner.geometry.attributes.normal, 0).equals(new Vector3(0, 0, 1)));
assert.equal(surfaceLabel('wall-right:outer', level), 'Right wall · outside');
assert.equal(surfaceLabel('floor', level), 'Floor');
// RAISED FLOOR (+0.30): top at the elevation, step sides all round facing outwards
{
    assert.equal(setFloorElevation(level, 'floor', 9), null, 'out of range');
    const raised = setFloorElevation(level, 'floor', 0.3);
    assert.equal(raised.floors[0].elevation, 0.3);
    assert.equal(setFloorElevation(raised, 'floor', 0).floors[0].elevation, undefined, '0 drops the field');
    const { geometry } = roomFaces(raised).find((face) => face.surfaceId === 'floor');
    const pos = geometry.attributes.position, nor = geometry.attributes.normal;
    let maxY = -Infinity, sides = 0;
    for (let i = 0; i < pos.count; i++) {
        maxY = Math.max(maxY, pos.getY(i));
        if (Math.abs(nor.getY(i)) < 1e-6) {
            sides++;
            // outwards: the normal points away from the room's center (0, 0)
            assert.ok(pos.getX(i) * nor.getX(i) + pos.getZ(i) * nor.getZ(i) > 0, 'side faces outwards');
        }
    }
    assert.ok(Math.abs(maxY - 0.3) < 1e-6 && sides === 4 * 4, 'top at +0.30, 4 side quads');
}
// CEILING (area tool, key 'ceilings'): a face at the wall height facing down, own id, area and label
{
    const withCeiling = addFloor(level, level.floors[0].points, undefined, 'ceilings');
    assert.ok(withCeiling.ceilings.length === 1 && withCeiling.ceilings[0].id.startsWith('c-'), 'ceiling ids: c-...');
    assert.equal(fillRoom(withCeiling, [0, 0], undefined, 'ceilings'), null, 'never a second ceiling over a ceiled point');
    const [ceiling] = withCeiling.ceilings;
    const face = roomFaces(withCeiling).find((f) => f.surfaceId === ceiling.id);
    const { position, normal } = face.geometry.attributes;
    let down = 0, up = 0;
    for (let i = 0; i < position.count; i++) {
        assert.ok(Math.abs(position.getY(i) - 2.7) < 1e-6, 'at 2.7');
        if (normal.getY(i) < -0.99) down++; else if (normal.getY(i) > 0.99) up++;
    }
    assert.ok(down > 0 && down === up && face.castShadow === true, 'underside + top, casts shadow');
    assert.ok(near(surfaceAreas(withCeiling)[ceiling.id], 36) && surfaceLabel(ceiling.id, withCeiling) === 'Ceiling');
    assert.equal(setCeilingHeight(withCeiling, ceiling.id, 0.1), null, 'out of range');
    assert.equal(setCeilingHeight(withCeiling, ceiling.id, 3).ceilings[0].height, 3);
    assert.ok(addFloor(level, [[0, 0], [1, 0], [1, 1]], 'x', 'ceilings').floors === level.floors, 'floors untouched');
}
// PITCHED CEILINGS on an 8 x 4 m rectangle, eaves at 2.5 m, 45° (rise 1 m per meter)
{
    const rect = addFloor(level, [[0, 0], [8, 0], [8, 4], [0, 4]], 'r', 'ceilings');
    const at = (lvl, x) => roofHeightAt(lvl.ceilings.at(-1), lvl, x);
    // eaves at 2.5, ridge at 4.5: the gable / hip ridge is 2 m in, so 45°; a single pitch rises over 4 m
    const roof = (type, ridgeHeight = 4.5) => setRoofRidgeHeight(setCeilingHeight(setCeilingRoof(rect, 'r', type), 'r', 2.5), 'r', ridgeHeight);
    assert.equal(roofFacets(rect.ceilings.at(-1), rect), null, 'flat by default');
    // gable: the long sides are the eaves, ridge along x at z = 2, 2 m above the eaves
    const gable = roof('gable');
    assert.equal(roofType(gable.ceilings.at(-1)), 'gable');
    assert.ok(Math.abs(at(gable, [4, 2]) - 4.5) < 1e-9 && Math.abs(at(gable, [0.5, 2]) - 4.5) < 1e-9 && Math.abs(at(gable, [4, 0]) - 2.5) < 1e-9, 'gable heights');
    assert.equal(roofFacets(gable.ceilings.at(-1), gable).length, 2, 'two facets');
    // true sloped area: 32 m² in plan x sqrt(2)
    const id = gable.ceilings.at(-1).id;
    assert.ok(Math.abs(surfaceAreas(gable)[id] - 32 * Math.SQRT2) < 0.011, 'sloped area');
    assert.ok(Math.abs(roofPitch(gable.ceilings.at(-1), gable) - 45) < 1e-9, 'pitch from the two heights');
    // rotated: the short sides become the eaves, the ridge (along z at x = 4) stays at 4.5: a gentler pitch
    const turned = rotateRoof(gable, 'r');
    assert.ok(Math.abs(at(turned, [4, 0.5]) - 4.5) < 1e-9 && Math.abs(at(turned, [2, 0.5]) - 3.5) < 1e-9, 'rotated gable');
    // eaves raised: the ridge does not move; never at / above the ridge
    const raised = setCeilingHeight(gable, 'r', 3.5);
    assert.ok(Math.abs(at(raised, [4, 2]) - 4.5) < 1e-9 && Math.abs(at(raised, [4, 0]) - 3.5) < 1e-9, 'eaves move, ridge stays');
    assert.equal(setCeilingHeight(gable, 'r', 4.5), null, 'eaves never up to the ridge');
    assert.equal(setRoofRidgeHeight(gable, 'r', 2.5), null, 'ridge never down to the eaves');
    // an old roof with a stored pitch still works (ridge from the pitch) and turns into heights when edited
    const legacy = { ...rect, ceilings: rect.ceilings.map((c) => (c.id === 'r' ? { ...c, height: 2.5, roof: { pitch: 45, eaves: [0, 2] } } : c)) };
    assert.ok(Math.abs(at(legacy, [4, 2]) - 4.5) < 1e-9, 'legacy pitch');
    const migrated = setCeilingHeight(legacy, 'r', 3).ceilings.at(-1).roof;
    assert.ok(migrated.pitch === undefined && Math.abs(migrated.ridgeHeight - 4.5) < 1e-9, 'legacy pitch becomes its ridge height');
    // hip ("4 falde"): ridge from (2, 2) to (6, 2) at 4.5; at the short ends the roof comes down
    const hip = roof('hip');
    assert.equal(roofFacets(hip.ceilings.at(-1), hip).length, 4, 'four facets');
    assert.ok(Math.abs(at(hip, [4, 2]) - 4.5) < 1e-9 && Math.abs(at(hip, [1, 2]) - 3.5) < 1e-9, 'hip heights');
    // single pitch: rises from the longest edge (z = 0) to z = 4
    assert.ok(Math.abs(at(roof('single', 6.5), [4, 4]) - 6.5) < 1e-9 && Math.abs(at(roof('single', 6.5), [4, 2]) - 4.5) < 1e-9, 'single pitch');
    // every facet point lies on the roof surface; geometry built with both faces
    const facets = roofFacets(hip.ceilings.at(-1), hip);
    for (const f of facets) for (const [x, y, z] of f.points) assert.ok(Math.abs(y - roofHeightAt(hip.ceilings.at(-1), hip, [x, z])) < 1e-9, 'facets on the surface');
    const face = roomFaces(hip).find((f) => f.surfaceId === 'r');
    assert.ok(face.geometry.index.count === 2 * facets.reduce((sum, f) => sum + 3 * (f.points.length - 2), 0), 'underside + top of every facet');
    assert.equal(setRoofRidgeHeight(rect, 'r', 4), null, 'no ridge on a flat ceiling');
    // EDITABLE RIDGE (hip): default centered (2, 2)-(6, 2) at 4.5; moved to z = 1 and stretched to (1, 1)-(7, 1)
    const ridge = roofRidge(hip.ceilings.at(-1), hip);
    assert.ok(!ridge.isCustom && Math.abs(ridge.height - 4.5) < 1e-9 && ridge.a[0] === 2 && ridge.b[0] === 6 && ridge.a[1] === 2, 'default ridge');
    assert.equal(roofRidge(gable.ceilings.at(-1), gable), null, 'only hip roofs');
    // a plan a few mm off a rectangle: the ridge ends differ by a hair in height, both must be kept (24/10 bug:
    // "Center ridge" collapsed the ridge to one point)
    const skew = setRoofRidgeHeight(setCeilingHeight(setCeilingRoof(addFloor(level, [[0, 0], [12, 0], [12.003, 6], [0, 6.002]], 's', 'ceilings'), 's', 'hip'), 's', 2.5), 's', 5);
    const skewRidge = roofRidge(skew.ceilings.at(-1), skew);
    assert.ok(Math.abs(Math.hypot(skewRidge.b[0] - skewRidge.a[0], skewRidge.b[1] - skewRidge.a[1]) - 6) < 0.01, 'near-rectangle: a 6 m ridge, not a point');
    const moved = setRoofRidge(hip, 'r', [[1, 1], [7, 1.3]]); // b off the axis: projected back onto it
    const mr = moved.ceilings.at(-1);
    assert.deepEqual(mr.roof.ridge, [[1, 1], [7, 1]], 'kept parallel to the longest side');
    assert.ok(roofRidge(mr, moved).isCustom);
    assert.ok(Math.abs(at(moved, [4, 1]) - 4.5) < 1e-9 && Math.abs(at(moved, [4, 0]) - 2.5) < 1e-9 && Math.abs(at(moved, [4, 4]) - 2.5) < 1e-9, 'moved ridge heights');
    const movedFacets = roofFacets(mr, moved);
    assert.equal(movedFacets.length, 4);
    for (const f of movedFacets) for (const [x, y, z] of f.points) assert.ok(Math.abs(y - roofHeightAt(mr, moved, [x, z])) < 1e-9, 'moved facets planar, on the surface');
    assert.equal(setRoofRidge(hip, 'r', [[1, 1], [9, 1]]), null, 'an end outside the polygon is refused');
    assert.equal(setRoofRidge(moved, 'r', null).ceilings.at(-1).roof.ridge, undefined, 'reset to the default');
    assert.equal(setCeilingRoof(moved, 'r', 'gable').ceilings.at(-1).roof.ridge, undefined, 'another type drops the ridge');
    // EXPOSED BEAMS on the default hip (ridge (2, 2)-(6, 2) at 4.5, eaves z = 0 / 4 at 2.5)
    assert.equal(setRoofBeams(hip, 'r', 1), null, 'at least 2');
    const beamed = setRoofBeams(hip, 'r', 3);
    const all = roofBeams(beamed.ceilings.at(-1), beamed);
    const beams = all.filter((b) => b.kind === 'rafter');
    assert.equal(beams.length, 6, '3 positions x 2 sides');
    // HIP BEAMS: one per corner, from the ridge end on its side, lowered below the hip line, square to it
    const hips = all.filter((b) => b.kind === 'hip');
    assert.equal(hips.length, 4, 'four hip beams');
    for (const { top: [u, l], across, down } of hips) {
        assert.ok((Math.abs(u[0] - 2) < 1e-9 || Math.abs(u[0] - 6) < 1e-9) && Math.abs(u[2] - 2) < 1e-9, 'from a ridge end');
        assert.ok([0, 8].some((x) => Math.abs(l[0] - x) < 1e-9) && [0, 4].some((z) => Math.abs(l[2] - z) < 1e-9), 'to a corner');
        assert.ok(u[1] < 4.5 && u[1] > 4.4 && Math.abs((4.5 - u[1]) - (2.5 - l[1])) < 1e-9, 'lowered by the same amount at both ends');
        const d = [l[0] - u[0], l[1] - u[1], l[2] - u[2]];
        assert.ok(Math.abs(d[0] * down[0] + d[1] * down[1] + d[2] * down[2]) < 1e-9 && down[1] < 0 && Math.abs(across[1]) < 1e-12, 'square to the hip line, vertical sides');
    }
    for (const beam of all) assert.equal(beam.depth, beam.kind === 'hip' ? 0.23 : 0.3, 'hip beams 23 cm deep, rafters 30');
    {
    }
    const xs = [...new Set(beams.map((b) => b.top[0][0]))];
    assert.deepEqual(xs, [2.07, 4, 5.93].map((x) => xs.find((v) => Math.abs(v - x) < 1e-9)), 'ends inset by half a section, middle one centered');
    for (const { top: [r, e], down } of beams) {
        assert.ok(Math.abs(r[1] - 4.5) < 1e-9 && Math.abs(e[1] - 2.5) < 1e-9 && (Math.abs(e[2]) < 1e-9 || Math.abs(e[2] - 4) < 1e-9), 'ridge to eave');
        assert.ok(down[1] < 0 && Math.abs(Math.hypot(...down) - 1) < 1e-9, 'hung below the roof');
        const slope = [e[0] - r[0], e[1] - r[1], e[2] - r[2]];
        assert.ok(Math.abs(slope[0] * down[0] + slope[1] * down[1] + slope[2] * down[2]) < 1e-9, 'square to the roof');
    }
    const beamFace = roomFaces(beamed).find((f) => f.surfaceId === 'r~beams');
    assert.ok(beamFace && beamFace.castShadow && beamFace.geometry.index.count === (6 + 4) * 6 * 6, 'boxes: 6 faces x 2 triangles');
    assert.equal(surfaceLabel('r~beams', beamed), 'Ceiling · beams');
    // plumb cuts: every beam vertex lies between the ridge line (z = 2) and its eave (z = 0 / 4) in plan
    const bp = beamFace.geometry.attributes.position;
    // (hip beams: their width sticks out a little at the corners, known: ponytail in planModel)
    for (let i = 0; i < 6 * 24; i++) assert.ok(bp.getZ(i) > -1e-6 && bp.getZ(i) < 4 + 1e-6, 'nothing past the eaves');
    let atRidge = 0;
    for (let i = 0; i < bp.count; i++) if (Math.abs(bp.getZ(i) - 2) < 1e-6 && bp.getY(i) < 4.5 - 0.3) atRidge++;
    assert.ok(atRidge > 0, 'bottom corners reach the ridge plane (beams joined under the ridge)');
    assert.equal(setRoofBeams(beamed, 'r', 0).ceilings.at(-1).roof.beams, undefined, '0 removes them');
    // DORMER BEAMS on the beamed hip (rafters at x = 2.07, 4, 5.93 on the long facets): a dormer at x = 3 on the
    // z = 0 facet -> 2 valley beams and a header between the rafters at 2.07 and 4 (their faces)
    const beamedDormer = addDormer(beamed, 'r', [3, 0.8], 'db');
    const bc = beamedDormer.ceilings.at(-1);
    const extra = dormerBeams(bc, beamedDormer, roofBeams(bc, beamedDormer));
    assert.deepEqual(extra.map((b) => b.kind), ['valley', 'valley', 'header']);
    const [, , head] = extra;
    const xs2 = head.top.map((p) => p[0]).sort((a, b) => a - b);
    const db = roofDormers(bc)[0];
    assert.ok(head.top.every((p) => Math.abs(p[1] - db.ridgeHeight) < 1e-9 && Math.abs(roofHeightAt(bc, beamedDormer, [p[0], p[2]]) - p[1]) < 1e-6), 'header top on the main roof at the dormer ridge');
    assert.ok(extra.every((b) => b.width === 0.15) && head.depth === 0.2, '15 wide, header 20 deep');
    // valleys: their bottom drops as much as the header's (no lip below it at the joint), never deeper than 15
    // at the joint (the header's front face) the valley's bottom is above the header's bottom (by 5 mm)
    const headerBottomY = head.top[0][1] - head.depth * Math.abs(head.down[1]);
    for (const v of extra.slice(0, 2)) {
        const [vt, vb] = v.top;
        const run = Math.hypot(vb[0] - vt[0], vb[2] - vt[2]);
        const dIn = Math.abs(vb[2] - vt[2]);                 // plan distance in from the eave (the facet's n is +z)
        const jointTop = vt[1] - (vt[1] - vb[1]) * (0.075 * run / dIn) / run;
        const jointBottom = jointTop - v.depth * Math.abs(v.down[1]);
        assert.ok(v.depth <= 0.15 + 1e-12 && Math.abs(jointBottom - (headerBottomY + 0.005)) < 1e-9, 'valley bottom 5 mm above the header bottom at the joint');
    }
    // valleys: cut on the header's front face (z = ridge back - 0.075) and on the axis plane (x = 3): every vertex
    // of the built beams on the valleys' side stays in front of the header face and on its own side of the axis
    const ridgeBackZ = head.top[0][2];
    for (const v of extra.slice(0, 2)) assert.equal(v.clips.length, 2, 'valley: header face + axis cuts');
    // header: ends at the rafters' centres, cut on their faces (2.07 + 0.07 and 4 - 0.07)
    assert.ok(Math.abs(xs2[0] - 2.07) < 1e-9 && Math.abs(xs2[1] - 4) < 1e-9 && head.clips.length === 2, 'header to the rafters, cut on their faces');
    const beamsFace = roomFaces(beamedDormer).find((f) => f.surfaceId === 'r~beams').geometry.attributes.position;
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    let headerVerts = 0;
    for (let i = 0; i < beamsFace.count; i++) {
        const [x, z] = [beamsFace.getX(i), beamsFace.getZ(i)];
        // header vertices: between the rafter faces, never inside a rafter
        if (Math.abs(z - ridgeBackZ) < 0.2 && x > 2.07 && x < 4) assert.ok(x >= 2.14 - 1e-6 && x <= 3.93 + 1e-6 || z < ridgeBackZ - 0.075 - 1e-6, 'header between the rafter faces');
        if (near(x, 2.14) || near(x, 3.93)) headerVerts++;
    }
    assert.ok(headerVerts >= 4, 'header end faces on the rafter faces');
    // VALLEYS ON TO THE WALLS: a wall square to the eave beyond a cheek's back end (x = 4.6, from z = 0 to 4):
    // the right valley goes on along its line and stops on that wall's face, cut flush there
    const walled = { ...beamedDormer, walls: [...beamedDormer.walls, { id: 'wv', a: [4.6, 0], b: [4.6, 4], thickness: 0.15 }] };
    const wc = walled.ceilings.at(-1);
    const wallValleys = dormerBeams(wc, walled, roofBeams(wc, walled)).filter((b) => b.kind === 'valley');
    const valleyOnWall = wallValleys.find((v) => v.clips.length === 3);
    assert.ok(valleyOnWall, 'one valley reaches the wall');
    // its box runs past the face and the face's plane cuts it: no vertex of the built beams beyond the face
    assert.ok(valleyOnWall.top[1][0] > 4.45, 'box past the face');
    const cutBeams = roomFaces(walled).find((f) => f.surfaceId === 'r~beams').geometry.attributes.position;
    const wallFaceX = Math.min(...[4.6, 4.75, 4.45].filter((x) => Math.abs(valleyOnWall.clips[2].point[0] - x) < 1e-6));
    let touching = 0;
    for (let i = 0; i < cutBeams.count; i++) {
        const [x, z] = [cutBeams.getX(i), cutBeams.getZ(i)];
        if (z > 0.3 && z < 1.9 && x > 4.2 && x < 5) {
            assert.ok(x <= wallFaceX + 1e-6, 'nothing past the wall face');
            if (Math.abs(x - wallFaceX) < 1e-6) touching++;
        }
    }
    assert.ok(touching >= 3, 'the valley end lies on the wall face');
    assert.ok(Math.abs(roofHeightAt(wc, walled, [valleyOnWall.top[1][0], valleyOnWall.top[1][2]]) - valleyOnWall.top[1][1]) < 1e-6, 'still on the main roof plane');
    // a dormer on a hip's END facet (between two hip beams): the header stops at the hips
    const endDormer = addDormer(beamed, 'r', [0.8, 2], 'de');
    const ec = endDormer.ceilings.at(-1);
    const endHeader = dormerBeams(ec, endDormer, roofBeams(ec, endDormer)).find((b) => b.kind === 'header');
    assert.ok(endHeader && endHeader.clips.length === 2, 'end facet: the header is cut on the two hip beams');
    // HIP MODE: valleys parallel to the hips at a clear 20 cm gap; the heights are derived and follow the width
    const parallel = (hip, [p, q]) => {
        const [u, v] = [[hip[1][0] - hip[0][0], hip[1][2] - hip[0][2]], [q[0] - p[0], q[1] - p[1]]];
        return Math.abs(u[0] * v[1] - u[1] * v[0]) / Math.hypot(...u) / Math.hypot(...v) < 1e-9;
    };
    const lineGap = (hip, x) => { // plan distance of point x from the hip's axis line
        const [a, b] = [[hip[0][0], hip[0][2]], [hip[1][0], hip[1][2]]];
        return Math.abs((b[0] - a[0]) * (x[1] - a[1]) - (b[1] - a[1]) * (x[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    };
    for (const width of [1.4, 1]) {
        const hipMode = updateDormer(endDormer, 'r', 'de', { hipOffset: 0.2, width });
        assert.ok(hipMode, `hip mode fits (width ${width})`);
        const hc = hipMode.ceilings.at(-1);
        assert.equal(hc.roof.dormers.at(-1).eaveHeight, ec.roof.dormers.at(-1).eaveHeight, 'stored heights untouched');
        const hd = roofDormers(hc, hipMode).at(-1);
        const lines = dormerLines(hc, hipMode, hd);
        const hipLines = roofBeams(hc, hipMode).filter((b) => b.kind === 'hip').map((b) => b.top);
        for (const cheek of lines.cheeks) {
            const valley = [cheek[1], lines.ridge[1]];
            const gaps = hipLines.filter((h) => parallel(h, valley)).map((h) => lineGap(h, valley[0])); // the far end's hips are parallel too
            assert.ok(gaps.length > 0, 'valley parallel to a hip');
            assert.ok(Math.abs(Math.min(...gaps) - (0.2 + 0.07 + 0.075)) < 1e-9, `clear gap 20 cm between the beams (${Math.min(...gaps)})`);
        }
        // the ridge's back end dragged in hip mode sets the GAP (Flavio 26/10): back end where the pointer is,
        // valleys still parallel, heights follow; dragged past the hips: the gap stops at 0
        const back = lines.ridge[1];
        const towardEave = [back[0] - 0.1, back[1]]; // this end facet's eave is x = 0: 10 cm nearer to it
        const dragged = dragDormer(hipMode, 'r', 'de', 'ridgeBack', towardEave, null, hd);
        assert.ok(dragged, 'hip gap dragged');
        const dd = roofDormers(dragged.ceilings.at(-1), dragged).at(-1);
        assert.ok(dd.hipOffset > 0.2 + 1e-6, `back end nearer the eave: wider gap (${dd.hipOffset})`);
        assert.ok(Math.abs(dormerLines(dragged.ceilings.at(-1), dragged, dd).ridge[1][0] - towardEave[0]) < 1e-9, 'the back end follows the pointer');
        assert.equal(dd.width, hd.width, 'width kept');
        const tight = dragDormer(hipMode, 'r', 'de', 'ridgeBack', [back[0] + 2, back[1]], null, hd); // far in, towards the hips
        assert.ok(tight === null || roofDormers(tight.ceilings.at(-1), tight).at(-1).hipOffset === 0, 'never past the hips: gap 0 at the least (or refused)');
    }
    assert.equal(dormerOnHips(ec, endDormer, roofDormers(ec)[0]), true, 'end facet: between hips');
    const noBeams = addDormer(hip, 'r', [3, 0.8], 'dn');
    assert.equal(dormerBeams(noBeams.ceilings.at(-1), noBeams).length, 0, 'none without the roof beams');
    // DORMERS on the gable (eaves z = 0 and z = 4 at 2.5, ridge z = 2 at 4.5: 1 m rise per meter)
    assert.equal(addDormer(gable, 'r', [4, 9]), null, 'not on the roof');
    const withDormer = addDormer(gable, 'r', [3, 0.8], 'd1');
    // ROOF HOLES: a 1 x 1 m hole on the z = 0 facet, beside the dormer (x 2.3..3.7)
    {
        const square = (x, z, s = 1) => [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];
        const holed = addRoofHole(withDormer, 'r', square(5, 0.5), 'h1');
        const hc = holed.ceilings.at(-1);
        assert.deepEqual(roofHoleFacets(hc, holed).map(({ hole, edge }) => [hole.id, edge]), [['h1', 0]], 'built on the facet of eave 0');
        assert.ok(Math.abs(surfaceAreas(withDormer).r - surfaceAreas(holed).r - Math.SQRT2) < 0.011, 'its sloped area (1 m² x sqrt 2) off the bill');
        // the roof geometry has no triangle over the hole
        const rg = roomFaces(holed).find((f) => f.surfaceId === 'r').geometry;
        const rp = rg.attributes.position, ri = rg.index.array;
        for (let i = 0; i < ri.length; i += 3) {
            const c = [0, 2].map((k) => [0, 1, 2].reduce((sum, j) => sum + rp.getComponent(ri[i + j], k), 0) / 3);
            assert.ok(!pointInPolygon(c, square(5, 0.5)), 'no roof over the hole');
        }
        assert.equal(addRoofHole(withDormer, 'r', square(2.5, 0.6, 0.5)), null, 'not over a dormer');
        // SHARED EDGES: a hole from the eave to the dormer's front (x 2.3..3.7, z 0..0.5): the roof between them
        // is gone, nothing left over (the sliver Flavio saw when it was drawn by eye)
        const front = addRoofHole(withDormer, 'r', [[2.3, 0], [3.7, 0], [3.7, 0.5], [2.3, 0.5]], 'hf');
        assert.ok(front && roofHoleFacets(front.ceilings.at(-1), front).length === 1, 'against the dormer and the eave: built');
        assert.ok(Math.abs(surfaceAreas(withDormer).r - surfaceAreas(front).r - 0.7 * Math.SQRT2) < 0.011, 'its area off');
        const fg = roomFaces(front).find((f) => f.surfaceId === 'r').geometry;
        const fp = fg.attributes.position, fi = fg.index.array;
        // plan area of the triangles on the z = 0 facet's plane (y = 2.5 + z; the dormer's roofs are above it),
        // both sides (underside + top): 2 x (16 - dormer footprint - hole 0.7)
        const footprintArea = polygonArea(dormerFootprint(withDormer.ceilings.at(-1), withDormer, roofDormers(withDormer.ceilings.at(-1))[0]));
        let planArea = 0;
        for (let i = 0; i < fi.length; i += 3) {
            const tri = [0, 1, 2].map((j) => [fp.getX(fi[i + j]), fp.getY(fi[i + j]), fp.getZ(fi[i + j])]);
            if (!tri.every(([, y, z]) => z <= 2 + 1e-9 && Math.abs(y - 2.5 - z) < 1e-6)) continue;
            const [a, b, c] = tri;
            planArea += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
        }
        assert.ok(Math.abs(planArea - 2 * (16 - footprintArea - 0.7)) < 1e-6, `roof left exactly around both (${planArea})`);
        assert.equal(addRoofHole(front, 'r', [[2.3, 0], [3.7, 0], [3.7, 0.5], [2.3, 0.5]]), null, 'the same hole twice: overlap');
        const targets = roofHoleTargets(withDormer.ceilings.at(-1), withDormer);
        assert.ok(targets.vertices.some((p) => Math.abs(p[0] - 2.3) < 1e-9 && Math.abs(p[1] - 0.5) < 1e-9), 'snap: the dormer\'s front corner');
        assert.ok(targets.segments.some(([p, q]) => Math.abs(p[1] - 2) < 1e-9 && Math.abs(q[1] - 2) < 1e-9), 'snap: the ridge');
        assert.equal(addRoofHole(holed, 'r', square(5.2, 0.7, 0.5)), null, 'not over another hole');
        assert.equal(addRoofHole(withDormer, 'r', square(5, 1.5)), null, 'not across the ridge (two facets)');
        assert.equal(addRoofHole(withDormer, 'r', square(7.5, 0.5)), null, 'not past the roof');
        assert.equal(addRoofHole(gable, 'r', [[5, 0.5], [6, 0.5]]), null, 'a polygon');
        assert.equal(moveRoofHoleVertex(holed, 'r', 'h1', 2, [6, 2.5]), null, 'a vertex moved across the ridge: refused');
        const moved = moveRoofHoleVertex(holed, 'r', 'h1', 2, [6.5, 1.8]);
        assert.deepEqual(roofHoles(moved.ceilings.at(-1))[0].points[2], [6.5, 1.8], 'vertex moved');
        assert.equal(roofHoleAt(hc, [5.5, 1]).id, 'h1');
        assert.equal(roofHoleAt(hc, [3, 1]), null);
        assert.equal(roofHoles(removeRoofHole(holed, 'r', 'h1').ceilings.at(-1)).length, 0, 'removed');
        // another roof type keeps the hole (a plan polygon); one across two facets stays in the data, cutting nothing
        const single = setCeilingRoof(holed, 'r', 'single');
        assert.equal(roofHoles(single.ceilings.at(-1)).length, 1, 'kept');
        const across = setCeilingRoof(addRoofHole(single, 'r', square(1, 1.5), 'h2'), 'r', 'gable'); // one facet, then the ridge at z = 2
        assert.equal(roofHoles(across.ceilings.at(-1)).length, 2);
        assert.deepEqual(roofHoleFacets(across.ceilings.at(-1), across).map(({ hole }) => hole.id), ['h1'], 'the one across the ridge cuts nothing');
        assert.equal(setCeilingRoof(holed, 'r', 'flat').ceilings.at(-1).roof, undefined, 'flat: no roof, no holes');
    }
    const dormer = roofDormers(withDormer.ceilings.at(-1))[0];
    assert.ok(dormer.eave === 0 && Math.abs(dormer.t - 3) < 1e-9 && dormer.width === 1.4 && dormer.setback === 0.5, 'placed on the facet clicked');
    assert.ok(Math.abs(dormer.eaveHeight - (2.5 + 0.5 + 1.2)) < 1e-9 && dormer.ridgeHeight > dormer.eaveHeight && dormer.ridgeHeight < 4.5, 'default heights');
    const lines = dormerLines(withDormer.ceilings.at(-1), withDormer, dormer);
    assert.ok(Math.abs(lines.front[0][0] - 2.3) < 1e-9 && Math.abs(lines.front[1][0] - 3.7) < 1e-9 && Math.abs(lines.front[0][1] - 0.5) < 1e-9, 'front line');
    assert.ok(Math.abs(lines.cheeks[0][1][1] - 1.7) < 1e-9, 'cheeks end where the roof reaches the dormer eave (4.2 m: 1.7 m in)');
    assert.ok(Math.abs(lines.ridge[1][1] - (dormer.ridgeHeight - 2.5)) < 1e-9, 'ridge ends where the roof reaches its height');
    // ridge back end dragged 0.1 m back towards the eave: ridge height -0.1 (length <-> height); the default one
    // is as long as the facet allows, so a longer one is refused
    const shorter = dragDormer(withDormer, 'r', 'd1', 'ridgeBack', [3, lines.ridge[1][1] - 0.1], null, dormer);
    assert.ok(Math.abs(roofDormers(shorter.ceilings.at(-1))[0].ridgeHeight - dormer.ridgeHeight + 0.1) < 1e-9, 'shorter ridge = lower ridge');
    assert.equal(dragDormer(withDormer, 'r', 'd1', 'ridgeBack', [3, 2.5], null, dormer), null, 'never past the main ridge');
    // front to the eave, width by a cheek, the whole dormer moved: heights follow the roof under it
    assert.equal(roofDormers(dragDormer(withDormer, 'r', 'd1', 'front', [3, 0], null, dormer).ceilings.at(-1))[0].setback, 0, 'front flush with the eave');
    // a cheek alone: the right one to x = 4, the left one stays at 2.3
    const wider = roofDormers(dragDormer(withDormer, 'r', 'd1', 'cheek1', [4, 0.5], null, dormer).ceilings.at(-1))[0];
    assert.ok(Math.abs(wider.width - 1.7) < 1e-9 && Math.abs(wider.t - 3.15) < 1e-9, 'one cheek moved');
    // SNAPS: a wall face along z (x = 4.1) catches the right cheek within 0.2 m; the ridge's back end near the
    // main ridge (z = 2) goes onto it
    const snap = { lines: [[[4.1, 0], [4.1, 4]], [[0, 1], [8, 1]]], radius: 0.2 };
    const onWall = roofDormers(dragDormer(withDormer, 'r', 'd1', 'cheek1', [4, 0.5], null, dormer, snap).ceilings.at(-1))[0];
    assert.ok(Math.abs(onWall.t + onWall.width / 2 - 4.1) < 1e-9, 'cheek on the wall face');
    const movedOnWall = roofDormers(dragDormer(withDormer, 'r', 'd1', 'move', [3.3, 0.8], [3, 0.8], dormer, snap).ceilings.at(-1))[0];
    assert.ok(Math.abs(movedOnWall.t + movedOnWall.width / 2 - 4.1) < 1e-9, 'moved: the nearer cheek snaps');
    const lowered = updateDormer(withDormer, 'r', 'd1', { ridgeHeight: 4.35 });
    const toMain = roofDormers(dragDormer(lowered, 'r', 'd1', 'ridgeBack', [3, 1.9], null, roofDormers(lowered.ceilings.at(-1))[0], snap).ceilings.at(-1))[0];
    assert.ok(Math.abs(toMain.ridgeHeight - 4.5) < 1e-9, 'ridge back end onto the main ridge');
    const shifted = roofDormers(dragDormer(withDormer, 'r', 'd1', 'move', [4, 0.7], [3, 0.8], dormer).ceilings.at(-1))[0];
    assert.ok(Math.abs(shifted.t - 4) < 1e-9 && Math.abs(shifted.setback - 0.4) < 1e-9 && Math.abs(shifted.eaveHeight - dormer.eaveHeight + 0.1) < 1e-9, 'moved with the roof');
    // never: an eave below the front, a ridge below the eave, a ridge past the facet, outside the eave
    assert.equal(updateDormer(withDormer, 'r', 'd1', { eaveHeight: 2.9 }), null, 'front wall needed');
    assert.equal(updateDormer(withDormer, 'r', 'd1', { ridgeHeight: dormer.eaveHeight }), null, 'pitched roof needed');
    assert.equal(updateDormer(withDormer, 'r', 'd1', { ridgeHeight: 4.6 }), null, 'ridge inside the facet');
    assert.equal(updateDormer(withDormer, 'r', 'd1', { t: 0.5 }), null, 'inside the eave');
    assert.equal(roofDormers(removeDormer(withDormer, 'r', 'd1').ceilings.at(-1)).length, 0, 'removed');
    // 3D: 2 cheeks + 2 small facets (front open, its outline kept); every roof point on its plane, valley points on the main roof
    const rc = withDormer.ceilings.at(-1);
    const solids = dormerSolids(rc, withDormer, dormer);
    assert.equal(solids.walls.length, 2, 'the two cheeks: the front is open');
    assert.equal(solids.roofs.length, 2);
    const { front } = solids;
    assert.ok(front.points.every((p) => Math.abs(p[2] - 0.5) < 1e-9) && Math.abs(front.points[0][1] - 3) < 1e-9 && Math.abs(Math.max(...front.points.map((p) => p[1])) - dormer.ridgeHeight) < 1e-9, 'front: on the setback line, from the roof (3.0) to the ridge');
    for (const roof of solids.roofs) {
        const [, , ridgeBack, valley] = roof.points;
        assert.ok(Math.abs(roofHeightAt(rc, withDormer, [ridgeBack[0], ridgeBack[2]]) - ridgeBack[1]) < 1e-9 && Math.abs(roofHeightAt(rc, withDormer, [valley[0], valley[2]]) - valley[1]) < 1e-9, 'valley ends on the main roof');
    }
    const faces = roomFaces(withDormer);
    assert.ok(faces.some((f) => f.surfaceId === 'r~dormerwalls') && surfaceLabel('r~dormerwalls', withDormer) === 'Ceiling · dormer walls', 'dormer walls: own surface');
    assert.ok(surfaceAreas(withDormer)['r~dormerwalls'] > 0, 'dormer walls in the bill');
    // the main facet is OPEN under the dormer: no triangle of the ceiling covers a point inside the footprint
    // (except the dormer's own small roofs, which are higher), and its area drops by the hole
    const ceilingGeometry = faces.find((f) => f.surfaceId === 'r').geometry;
    const pos = ceilingGeometry.attributes.position, idx = ceilingGeometry.index.array;
    const probe = [3, 1.0]; // inside the footprint (x 2.3..3.7, z 0.5..), on the main roof at y = 3.5
    let covered = false;
    for (let i = 0; i < idx.length; i += 3) {
        const tri = [0, 1, 2].map((j) => [pos.getX(idx[i + j]), pos.getY(idx[i + j]), pos.getZ(idx[i + j])]);
        const inside = pointInPolygon(probe, tri.map((p) => [p[0], p[2]]));
        if (inside && Math.min(...tri.map((p) => p[1])) < 3.6) covered = true; // a main-roof triangle under it
    }
    assert.ok(!covered, 'hole in the main facet under the dormer');
    assert.ok(surfaceAreas(withDormer).r < surfaceAreas(gable).r + 3, 'area: hole subtracted, small roofs added');
    assert.equal(setCeilingRoof(hip, 'r', 'flat').ceilings.at(-1).roof, undefined, 'flat drops the roof');
}
// WALLS UNDER A PITCHED ROOF (3c): the 6 x 6 m test room (walls at x = +-3 and z = -3, 2.7 m) under a gable
// 7 x 7 m roof, eaves on z = -3.5 / 3.5 at 2.0 m, ridge on z = 0 at 4.0 m (rise 2 / 3.5 per meter)
{
    const covered = setRoofRidgeHeight(setCeilingHeight(setCeilingRoof(addFloor(level, [[-3.5, -3.5], [3.5, -3.5], [3.5, 3.5], [-3.5, 3.5]], 'g', 'ceilings'), 'g', 'gable'), 'g', 2), 'g', 4);
    const roofY = (z) => 2 + (3.5 - Math.abs(z)) * (2 / 3.5);
    const faceOf = (id) => roomFaces(covered).find((f) => f.surfaceId === id).geometry.attributes.position;
    const maxY = (pos) => Math.max(...Array.from({ length: pos.count }, (_, i) => pos.getY(i)));
    // eave wall (z = -3): every top vertex on the roof, lower than its 2.7 m
    const back = faceOf('wall-back:inner');
    for (let i = 0; i < back.count; i++) if (back.getY(i) > 0.01) assert.ok(Math.abs(back.getY(i) - roofY(back.getZ(i))) < 1e-6, 'eave wall: top on the roof');
    assert.ok(maxY(back) < 2.7, 'eave wall cut down');
    // gable wall (x = -3, z from -3 to 3): its top rises to the ridge at z = 0 -> the gable is closed
    const left = faceOf('wall-left:inner');
    assert.ok(Math.abs(maxY(left) - 4) < 1e-6, 'gable wall up to the ridge');
    for (let i = 0; i < left.count; i++) if (left.getY(i) > 0.01) assert.ok(Math.abs(left.getY(i) - roofY(left.getZ(i))) < 1e-6, 'gable wall: top on the roof');
    // no top cap under the roof; areas follow the cut (eave wall smaller, gable wall bigger)
    const areasCovered = surfaceAreas(covered);
    assert.ok(areasCovered['wall-back:inner'] < areas['wall-back:inner'] && areasCovered['wall-left:inner'] > areas['wall-left:inner'], 'areas follow the roof');
    // a DORMER over the eave wall (front flush with the eave, 1.4 m wide around x = 0): that wall's top follows
    // the dormer's roof there, up to its ridge over the axis (a step at its cheeks)
    const withDormerOver = updateDormer(addDormer(covered, 'g', [0, -2.8], 'dd'), 'g', 'dd', { setback: 0 });
    const dd = roofDormers(withDormerOver.ceilings.at(-1))[0];
    const backUnder = roomFaces(withDormerOver).find((f) => f.surfaceId === 'wall-back:outer').geometry.attributes.position;
    const pitchD = (dd.ridgeHeight - dd.eaveHeight) / (dd.width / 2);
    let peak = 0;
    for (let i = 0; i < backUnder.count; i++) {
        const [x, y] = [backUnder.getX(i), backUnder.getY(i)];
        if (y < 0.01 || Math.abs(x) >= dd.width / 2 - 1e-6) continue;
        assert.ok(Math.abs(y - (dd.ridgeHeight - pitchD * Math.abs(x - dd.t + 3.5))) < 1e-6 || y <= roofY(-3.2) + 1e-6, 'under the dormer: its roof');
        peak = Math.max(peak, y);
    }
    assert.ok(Math.abs(peak - dd.ridgeHeight) < 0.01, 'the wall rises to the dormer ridge');
    // no wedge at the cheeks (24/10 bug): every top vertex of that face is EITHER on the main roof OR on the dormer's
    // roof (at a cheek both exist: a vertical step), never in between
    for (let i = 0; i < backUnder.count; i++) {
        const [x, y, z] = [backUnder.getX(i), backUnder.getY(i), backUnder.getZ(i)];
        if (y < 0.01) continue;
        const onMain = Math.abs(y - roofY(z)) < 1e-6;
        const onDormer = Math.abs(x) <= dd.width / 2 + 1e-6 && Math.abs(y - (dd.ridgeHeight - pitchD * Math.abs(x - dd.t + 3.5))) < 1e-6;
        assert.ok(onMain || onDormer, `top vertex (${x.toFixed(3)}, ${y.toFixed(3)}) on a roof`);
    }
    // wall tops under the roof: a cap following the roof, flagged to show only without the roof
    const caps = roomFaces(covered).filter((f) => f.onlyWithoutRoof);
    assert.ok(caps.some((f) => f.surfaceId === 'wall-left:edge'), 'gable wall: a top cap for the hidden-roof view');
    const capPos = caps.find((f) => f.surfaceId === 'wall-left:edge').geometry.attributes.position;
    assert.ok(Math.abs(Math.max(...Array.from({ length: capPos.count }, (_, i) => capPos.getY(i))) - 4) < 0.1, 'it follows the roof up to the ridge');
    // the eave wall's TOP under the dormer (ceilings hidden): cut along the roof lines, every vertex on the main roof
    // or on the dormer's roof (risers at the cheeks), and every triangle flat on one of them (no twisted quads)
    const cap = roomFaces(withDormerOver).find((f) => f.surfaceId === 'wall-back:edge' && f.onlyWithoutRoof).geometry;
    const cp = cap.attributes.position, ci = cap.index.array;
    const onMainY = (x, z) => roofY(z), onDormerY = (x) => dd.ridgeHeight - pitchD * Math.abs(x - dd.t + 3.5);
    for (let i = 0; i < ci.length; i += 3) {
        const tri = [0, 1, 2].map((j) => [cp.getX(ci[i + j]), cp.getY(ci[i + j]), cp.getZ(ci[i + j])]);
        const flatOn = (f) => tri.every(([x, y, z]) => Math.abs(y - f(x, z)) < 1e-6);
        const vertical = Math.abs((tri[1][0] - tri[0][0]) * (tri[2][2] - tri[0][2]) - (tri[2][0] - tri[0][0]) * (tri[1][2] - tri[0][2])) < 1e-9;
        assert.ok(vertical || flatOn(onMainY) || flatOn(onDormerY), 'cap triangle on one roof (or a vertical riser)');
    }
    // a dormer cheek EXACTLY on a wall's face (snapped onto it): that wall does not rise to the dormer (no doubled
    // cheek). wall-left's inner face is its drawn line, x = -3 (its thickness goes outwards): the left cheek put there
    const leftFace = -3;
    const onFace = updateDormer(addDormer(covered, 'g', [-2, -2.8], 'dc'), 'g', 'dc', { t: leftFace + 3.5 + 0.7, width: 1.4, setback: 0.2 });
    assert.ok(onFace, 'cheek on the wall face');
    const leftInner = roomFaces(onFace).find((f) => f.surfaceId === 'wall-left:inner').geometry.attributes.position;
    for (let i = 0; i < leftInner.count; i++) if (leftInner.getY(i) > 0.01) assert.ok(Math.abs(leftInner.getY(i) - roofY(leftInner.getZ(i))) < 1e-6, 'wall beside the dormer stays under the main roof');
    // a flat ceiling changes nothing
    const flat = addFloor(level, [[-3.5, -3.5], [3.5, -3.5], [3.5, 3.5], [-3.5, 3.5]], 'f', 'ceilings');
    assert.ok(Math.abs(surfaceAreas(flat)['wall-back:inner'] - areas['wall-back:inner']) < 1e-9, 'flat ceiling: walls unchanged');
    // PARAPET on the eave wall (wall-back: inner face z = -3 under the roof at 2.29, outer z = -3.15 at 2.2):
    // the outer face (lower roof) stays on the roof, the inner one drops to 1 m above the floor (elevation 0)
    {
        assert.equal(setWallParapet(covered, 'wall-back', 0.01), null, 'out of range');
        // no hole: the roof covers it, the wall goes on under the roof as before
        const plain = setWallParapet(covered, 'wall-back', 1);
        const innerOf = (lvl) => roomFaces(lvl).find((f) => f.surfaceId === 'wall-back:inner').geometry.attributes.position;
        assert.ok(Math.abs(Math.max(...Array.from({ length: innerOf(plain).count }, (_, i) => innerOf(plain).getY(i))) - roofY(-3)) < 1e-6, 'no hole: inner face on the roof');
        assert.ok(!roomFaces(plain).some((f) => f.surfaceId === 'wall-back:edge' && !f.vertical && !f.onlyWithoutRoof), 'no hole: no visible top');
        // a hole over the terrace, its edge on the outer face (z -3.15) and all along the wall: the counter-slope
        // from the outer face's top (on the roof) down to the inner face at 1 m
        const terrace = (lvl) => addRoofHole(lvl, 'g', [[-3.5, -3.15], [3.5, -3.15], [3.5, -1], [-3.5, -1]], 'all');
        const parapet = terrace(plain);
        const maxY = (id) => { const p = roomFaces(parapet).find((f) => f.surfaceId === id).geometry.attributes.position; return Math.max(...Array.from({ length: p.count }, (_, i) => p.getY(i))); };
        assert.ok(Math.abs(maxY('wall-back:inner') - 1) < 1e-9, 'inner face down to the parapet height');
        assert.ok(Math.abs(maxY('wall-back:outer') - roofY(-3.15)) < 1e-6, 'outer face still on the roof');
        const cap = roomFaces(parapet).find((f) => f.surfaceId === 'wall-back:edge' && !f.vertical && !f.onlyWithoutRoof);
        assert.ok(cap, 'a sloped top, shown with the roof');
        const cp = cap.geometry.attributes.position, cn = cap.geometry.attributes.normal;
        for (let i = 0; i < cp.count; i++) {
            if (cn.getY(i) < 1e-3) continue; // the end risers (below)
            const z = cp.getZ(i), y = cp.getY(i);
            assert.ok(Math.abs(z + 3) < 1e-6 ? Math.abs(y - 1) < 1e-6 : Math.abs(y - roofY(z)) < 1e-6, 'from the roof (outside) down to 1 m (inside)');
        }
        assert.ok(cn.getY(0) > 0, 'facing up');
        // both ends are JOINED (wall-left, wall-right go on under the roof): a riser at each end closes the gap from
        // the sloped top up to the roof (Flavio 26/10: triangles open at the corner)
        const risers = Array.from({ length: cp.count }, (_, i) => i).filter((i) => Math.abs(cn.getY(i)) < 1e-9);
        for (const x of [-3, 3]) {
            assert.ok(risers.some((i) => Math.abs(cp.getX(i) - x) < 1e-6 && Math.abs(cp.getZ(i) + 3) < 1e-6 && Math.abs(cp.getY(i) - roofY(-3)) < 1e-6), `end x = ${x}: closed up to the roof`);
        }
        // a raised floor in front: measured from it
        const raised = terrace(setWallParapet(setFloorElevation(covered, 'floor', 0.3), 'wall-back', 1));
        const rp = roomFaces(raised).find((f) => f.surfaceId === 'wall-back:inner').geometry.attributes.position;
        assert.ok(Math.abs(Math.max(...Array.from({ length: rp.count }, (_, i) => rp.getY(i))) - 1.3) < 1e-6, `from the raised floor (${Math.max(...Array.from({ length: rp.count }, (_, i) => rp.getY(i)))})`);
        assert.ok(surfaceAreas(parapet)['wall-back:inner'] < surfaceAreas(covered)['wall-back:inner'], 'inner face area smaller');
        assert.equal(setWallParapet(parapet, 'wall-back', null).walls.find((w) => w.id === 'wall-back').parapet, undefined, 'off: back to the roof');
        // THE BREAK = the roof hole's edge (Flavio 26/10): the roof runs on up to it, then the counter-slope down
        // to the parapet face. Hole over the terrace from z = zb to -1 (x -2..2)
        const capWith = (zb) => {
            const lvl = addRoofHole(plain, 'g', [[-2, zb], [2, zb], [2, -1], [-2, -1]], 'th');
            assert.ok(lvl, `hole from z = ${zb}`);
            const faces = roomFaces(lvl);
            const cap = faces.find((f) => f.surfaceId === 'wall-back:edge' && !f.vertical && !f.onlyWithoutRoof).geometry.attributes.position;
            const outer = faces.find((f) => f.surfaceId === 'wall-back:outer').geometry.attributes.position;
            // heights of the cap's TOP vertices at z (risers, vertical at the hole's sides, left out)
            const capNormal = faces.find((f) => f.surfaceId === 'wall-back:edge' && !f.vertical && !f.onlyWithoutRoof).geometry.attributes.normal;
            const ys = (p, z) => Array.from({ length: p.count }, (_, i) => i).filter((i) => Math.abs(p.getZ(i) - z) < 1e-6 && p.getY(i) > 0.01 && capNormal.getY(i) > 1e-3).map((i) => p.getY(i));
            // the outer face's top at the hole's edge x = 2 (the LOWEST there: the step down from the roof beside it)
            const outerTop = Math.min(...Array.from({ length: outer.count }, (_, i) => i).filter((i) => Math.abs(outer.getX(i) - 2) < 1e-6 && outer.getY(i) > 0.01).map((i) => outer.getY(i)));
            return { cap, outerTop, ys, area: surfaceAreas(lvl)['wall-back:edge'] };
        };
        // inside the wall (z -3.07, between the faces -3.15 and -3): roof up to it, then down to 1 m
        {
            const { cap, outerTop, ys } = capWith(-3.07);
            assert.ok(Math.abs(outerTop - roofY(-3.15)) < 1e-6, 'outer face on the roof');
            assert.ok(ys(cap, -3.07).length > 0 && ys(cap, -3.07).every((y) => Math.abs(y - roofY(-3.07)) < 1e-6), 'cap at the break: on the roof');
            assert.ok(ys(cap, -3).every((y) => Math.abs(y - 1) < 1e-6), 'down to the parapet');
        }
        // an OBLIQUE hole edge (Flavio 26/10: a triangle stayed open): from z -3.3 at x = -2 (beyond the outer face)
        // to -3.05 at x = 2 (inside the wall), crossing the outer face (-3.15) at x = 0.4. The VISIBLE top covers
        // exactly: x -2..0.4 from the edge to the inner face z = -3 (0.30 -> 0.15 wide: 0.54 m²), x 0.4..2 from the
        // break down to the inner face (0.10 -> 0.05 wide: 0.12 m²) = 0.66 m²... (0.70 measured); the strip from the
        // outer face up to the break lies ON the roof: in its own face, shown only with the ceilings hidden (it
        // z-fought with the roof, 26/10). Together they cover the plan exactly once: 0.78 m²
        {
            const lvl = addRoofHole(plain, 'g', [[-2, -3.3], [2, -3.05], [2, -1], [-2, -1]], 'ob');
            const planArea = (g) => {
                const p = g.attributes.position, n = g.attributes.normal, idx = g.index.array;
                let sum = 0;
                for (let i = 0; i < idx.length; i += 3) {
                    if (n.getY(idx[i]) < 1e-3) continue; // risers
                    const [a, b, c] = [0, 1, 2].map((j) => [p.getX(idx[i + j]), p.getZ(idx[i + j])]);
                    sum += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
                }
                return sum;
            };
            const edges = roomFaces(lvl).filter((f) => f.surfaceId === 'wall-back:edge' && !f.vertical);
            const visible = planArea(edges.find((f) => !f.onlyWithoutRoof).geometry);
            const onRoof = planArea(edges.find((f) => f.onlyWithoutRoof).geometry);
            // on the roof: x 0.4..2, from the outer face z = -3.15 to the break (0 -> 0.10 deep): 0.08 m²
            assert.ok(Math.abs(onRoof - 0.08) < 1e-6, `the strip on the roof, apart (${onRoof})`);
            assert.ok(Math.abs(visible + onRoof - 0.78) < 1e-6, `oblique edge: no gap, no overlap (${visible} + ${onRoof})`);
            assert.equal(onRoofPlane(lvl, ['wall-back:edge'], (x, z) => roofY(z)), 0, 'nothing visible on the roof plane');
        }
        // out beyond the outer face (z -3.3): the counter-slope starts there; the outer face's top is on it and
        // the cap reaches out to the hole's edge
        {
            const { cap, outerTop, ys, area } = capWith(-3.3);
            const yb = roofY(-3.3);
            assert.ok(Math.abs(outerTop - (yb + (1 - yb) * 0.15 / 0.3)) < 1e-6, 'outer face on the counter-slope');
            assert.ok(ys(cap, -3.3).length > 0 && ys(cap, -3.3).every((y) => Math.abs(y - yb) < 1e-6), 'cap out to the hole edge, on the roof there');
            const wallLength = 4; // the hole is 4 m wide (x -2..2): the counter-slope only there
            assert.ok(area > Math.hypot(0.3, yb - 1) * wallLength - 1e-6, 'bill: the whole counter-slope');
            // the steps at the hole's sides (x = ±2) face the hole (front faces only, as drawn): rays from x = 0
            // outwards, between the sloped top and the roof, hit them
            const lvl = addRoofHole(plain, 'g', [[-2, -3.3], [2, -3.3], [2, -1], [-2, -1]], 'th');
            const front = roomFaces(lvl).filter((f) => !f.onlyWithoutRoof).map((f) => new Mesh(f.geometry, new MeshBasicMaterial()));
            const caster = new Raycaster();
            let open = 0;
            for (const sx of [-1, 1]) for (let z = -3.28; z <= -3.02; z += 0.02) {
                caster.set(new Vector3(sx * 1.9, 20, z), new Vector3(0, -1, 0)); caster.far = Infinity;
                const capY = caster.intersectObjects(front, false)[0].point.y;
                for (let y = capY + 0.005; y < roofY(z) - 0.005; y += 0.005) {
                    caster.set(new Vector3(0, y, z), new Vector3(sx, 0, 0)); caster.far = 2.1;
                    if (!caster.intersectObjects(front, false)[0]) open++;
                }
            }
            assert.equal(open, 0, 'steps at the hole\'s sides: closed, facing the hole');
        }
    }
}
// PARAPET ENDS on Flavio's terrace (26/10, his plan): free ends, the hole drawn 0.1 mm past one of them and its edge
// 50 cm out beyond the roof side face. Between the sloped top and the roof, at both ends, horizontal rays from the
// terrace outwards must hit the closure (a triangle was open: the end was taken as "inside the hole")
{
    const terrace = {
        ...level,
        floors: [{ id: 'tf', points: [[-8.5, -1.6], [-6.54, -1.6], [-6.54, 1.6], [-8.5, 1.6]], elevation: 0.3 }],
        walls: [{ id: 'pw', a: [-8.650035114084865, -1.5998720925046352], b: [-8.650035114084865, 1.6000086178808925], thickness: 0.15, parapet: 0.95 }],
        ceilings: [{ id: 'tc', height: 1, points: [[-9.709239199867552, -5.4092465326258585], [-9.709635017625075, 5.40963176702088], [9.709176758028798, 5.409214782538357], [9.709697459463827, -5.4097238422746345]],
            roof: { ridgeHeight: 3.95, eaves: [0, 1, 2, 3], ridge: [[-4.299989554858967, 0.00006805753855321228], [4.376686253752401, -0.00014521166126991685]],
                holes: [{ id: 'th', points: [[-9.150035492062097, -1.599976867793391], [-7.406256351753738, -1.5999561745051654], [-7.406373406220409, 1.5994910591754519], [-9.149876741624588, 1.6000086178808925]] }] } }]
    };
    // FRONT faces only, as the materials draw them (26/10: the closure was there but facing away, still a hole)
    const meshes = roomFaces(terrace).filter((f) => !f.onlyWithoutRoof).map((f) => new Mesh(f.geometry, new MeshBasicMaterial()));
    const ray = new Raycaster();
    for (const s of [-1, 1]) {
        let open = 0;
        for (let x = -9.13; x <= -8.51; x += 0.04) {
            ray.set(new Vector3(x, 20, s * 1.55), new Vector3(0, -1, 0)); ray.far = Infinity;
            const capY = ray.intersectObjects(meshes, false)[0].point.y;
            const roof = roofHeightAt(terrace.ceilings[0], terrace, [x, s * 1.6]);
            for (let y = capY + 0.01; y < roof - 0.01; y += 0.01) {
                ray.set(new Vector3(x, y, s * 1.5), new Vector3(0, 0, s)); ray.far = 0.2;
                if (!ray.intersectObjects(meshes, false)[0]) open++;
            }
        }
        assert.equal(open, 0, `parapet end z ${s > 0 ? '+' : '-'}: closed up to the roof`);
    }
    assert.deepEqual(parapetLeaks(terrace, 'pw', 1), { top: 0, sides: 0, covers: 0 }, "Flavio's terrace: no leak (generic probe, below)");
}
/*
* PARAPET ROBUSTNESS (26/10, Flavio: "the algorithm must hold beyond my example"). A generic LEAK PROBE on front
* faces only (as the app draws them), for a parapet wall `wallId` whose terrace lies on the `terrace` side (+1:
* towards the wall's normal, -1: the other way):
* - TOP: every point over the wall and over a 60 cm strip on the roof side, seen from straight above, shows
*   something (the sloped top, the roof, a wall), never a floor or nothing. On the terrace side, inside a hole,
*   the floor is fine (that is the terrace).
* - SIDES: wherever the top steps along the wall (its ends, the holes' corners) with the roof just past it,
*   horizontal rays from the hole's side between the top and the roof hit a closure.
* - COVERS: over the terrace (inside the hole, past the terrace face), the wall's top never shows.
* Returns the number of leaking rays of each kind.
*/
function parapetLeaks(lvl, wallId, terrace) {
    const meshes = roomFaces(lvl).filter((f) => !f.onlyWithoutRoof).map((f) => Object.assign(new Mesh(f.geometry, new MeshBasicMaterial()), { name: f.surfaceId }));
    const ray = new Raycaster();
    const wall = lvl.walls.find((w) => w.id === wallId);
    const { dir, normal, length } = wallFrame(wall);
    const { inner, outer } = faceOffsets(wall);
    const ceiling = lvl.ceilings[0];
    const holes = roofHoleFacets(ceiling, lvl).map(({ hole }) => hole.points);
    const inHole = (p) => holes.some((h) => pointInPolygon(p, h));
    const at = (t, o) => [wall.a[0] + dir[0] * t + normal[0] * o, wall.a[1] + dir[1] * t + normal[1] * o];
    const terraceFace = terrace > 0 ? Math.max(inner, outer) : Math.min(inner, outer);
    const roofFace = terrace > 0 ? Math.min(inner, outer) : Math.max(inner, outer);
    const down = (p) => { ray.set(new Vector3(p[0], 50, p[1]), new Vector3(0, -1, 0)); ray.far = Infinity; return ray.intersectObjects(meshes, false)[0]; };
    let top = 0, sides = 0, covers = 0;
    for (let t = 0.01; t < length - 0.01; t += 0.03) {
        for (let o = roofFace - terrace * 0.6; (o - terraceFace) * terrace < -0.005; o += terrace * 0.02) {
            const p = at(t, o);
            if (!pointInPolygon(p, ceiling.points)) continue; // off the roof: nothing to see there
            const hit = down(p);
            if (!hit || hit.object.name.startsWith('f') || hit.object.name === 'tf') top++;
        }
    }
    // the TERRACE stays open: over the hole past the terrace face, from above, never this wall's top
    for (let t = 0.01; t < length - 0.01; t += 0.03) {
        for (let o = terraceFace + terrace * 0.02; (o - terraceFace) * terrace < 0.4; o += terrace * 0.02) {
            const p = at(t, o);
            if (inHole(p) && down(p)?.object.name === `${wallId}:edge`) covers++;
        }
    }
    // the step planes: the wall's ends and the holes' corners projected on the line
    const cuts = [0, length, ...holes.flat().map((q) => (q[0] - wall.a[0]) * dir[0] + (q[1] - wall.a[1]) * dir[1]).filter((t) => t > 0 && t < length)];
    for (const t of cuts) for (const s of [-1, 1]) {
        for (let o = roofFace - terrace * 0.6; (o - terraceFace) * terrace < -0.005; o += terrace * 0.02) {
            const inside = at(t - s * 0.03, o), beyond = at(t + s * 0.03, o);
            if (!inHole(inside) || inHole(beyond)) continue; // a step only from the hole to the roof
            const capHit = down(inside);
            if (!capHit) { sides++; continue; }
            const roofY = roofHeightAt(ceiling, lvl, beyond);
            for (let y = capHit.point.y + 0.01; y < roofY - 0.01; y += 0.01) {
                const start = at(t - s * 0.03, o);
                ray.set(new Vector3(start[0], y, start[1]), new Vector3(dir[0] * s, 0, dir[1] * s)); ray.far = 0.06;
                if (!ray.intersectObjects(meshes, false)[0]) sides++;
            }
        }
    }
    return { top, sides, covers };
}
{
    // gable 8 x 4 (eaves z = 0 / 4 at 2.5, ridge z = 2 at 4.5) and the same rectangle as a hip (end facets x < 2, x > 6)
    const rect = addFloor({ ...level, walls: [], floors: [] }, [[0, 0], [8, 0], [8, 4], [0, 4]], 'c', 'ceilings');
    const roofOf = (type) => setRoofRidgeHeight(setCeilingHeight(setCeilingRoof(rect, 'c', type), 'c', 2.5), 'c', 4.5);
    const scene = (type, walls, holes, floors = []) => {
        let lvl = { ...roofOf(type), walls: walls.map((w) => ({ thickness: 0.15, parapet: 0.95, ...w })), floors };
        holes.forEach((points, i) => { lvl = addRoofHole(lvl, 'c', points, `h${i}`); assert.ok(lvl, `hole ${i} fits`); });
        return lvl;
    };
    const ok = (name, lvl, wallId, terrace) => {
        const leaks = parapetLeaks(lvl, wallId, terrace);
        assert.deepEqual(leaks, { top: 0, sides: 0, covers: 0 }, `${name}: no leak (${JSON.stringify(leaks)})`);
    };
    // 1. on a HIP END facet (eave x = 0): parapet along z at x 0.5 (thickness towards +x), hole from x 0.2 out to 0.9
    ok('hip end facet', scene('hip', [{ id: 'p', a: [0.5, 1.2], b: [0.5, 2.8] }], [[[0.2, 1.2], [0.9, 1.2], [0.9, 2.8], [0.2, 2.8]]]), 'p', 1);
    // 2. OBLIQUE to the eave on that facet, the hole squared on the wall (drawn with the wall face snaps): in the
    // wall's frame t 0.05..1.55 along, from 25 cm out beyond its roof side face to 30 cm past its terrace face
    {
        const wall = { id: 'p', a: [0.45, 1.2], b: [0.6, 2.8] };
        const { dir, normal } = wallFrame(wall);
        const at = (t, o) => [wall.a[0] + dir[0] * t + normal[0] * o, wall.a[1] + dir[1] * t + normal[1] * o];
        ok('oblique wall', scene('hip', [wall], [[at(0.05, -0.25), at(1.55, -0.25), at(1.55, 0.45), at(0.05, 0.45)]]), 'p', 1);
    }
    // 2b. the hole NOT squared on that oblique wall (its sides follow the plan's axes): the step along each side
    // is oblique to the wall (26/10: a 50 cm step stayed open there)
    ok('hole oblique to the wall', scene('hip', [{ id: 'p', a: [0.45, 1.2], b: [0.6, 2.8] }], [[[0.2, 1.25], [0.95, 1.25], [0.95, 2.75], [0.2, 2.75]]]), 'p', 1);
    // 3. TWO HOLES along one wall (gable eave z = 0; wall z 0.35..0.5, terrace towards +z: the normal is -z)
    ok('two holes', scene('gable', [{ id: 'p', a: [1, 0.5], b: [7, 0.5] }], [[[1.5, 0.2], [3, 0.2], [3, 1.5], [1.5, 1.5]], [[4, 0.2], [6, 0.2], [6, 1.5], [4, 1.5]]]), 'p', -1);
    // 4. hole edge with a CORNER over the wall (out beyond it at the ends, inside it at x = 4)
    ok('cornered edge', scene('gable', [{ id: 'p', a: [1, 0.5], b: [7, 0.5] }], [[[2, 0.2], [4, 0.42], [6, 0.2], [6, 1.5], [2, 1.5]]]), 'p', -1);
    // 5. EVEN ROOF on both faces: a wall running up the slope (a = (3, 0.3) -> b = (3, 1.6): faces x = 3 and, along
    // its normal +x, x = 3.15), the hole's edge inside it (x = 3.075); the terrace on either side
    const upSlope = { id: 'p', a: [3, 0.3], b: [3, 1.6] };
    ok('even roof, terrace on the -x side', scene('gable', [upSlope], [[[1.5, 0.3], [3.075, 0.3], [3.075, 1.6], [1.5, 1.6]]]), 'p', -1);
    ok('even roof, terrace on the +x side', scene('gable', [upSlope], [[[3.075, 0.3], [4.5, 0.3], [4.5, 1.6], [3.075, 1.6]]]), 'p', 1);
}
// FALSE CEILING (controsoffitto, Flavio 26/10): a flat ceiling extruded UPWARDS by its thickness, sides of their own,
// cut by the pitched roofs over it. Probed with rays on FRONT faces only (as drawn): from straight above, the
// ceiling's own top is at H where the roof is above it and absent under the roof (the roof closes the volume: no
// faces on the roof's plane, they z-fought with it); from outside, horizontally, the sides close everything between
// the underside and min(H, roof).
// Triangles of the faces `ids` lying ON the roof (every vertex at roofAt(x, z)): coplanar with it = z-fighting
function onRoofPlane(lvl, ids, roofAt) {
    let count = 0;
    for (const face of roomFaces(lvl).filter((f) => ids.includes(f.surfaceId) && !f.onlyWithoutRoof)) {
        const p = face.geometry.attributes.position, index = face.geometry.index?.array ?? Array.from({ length: p.count }, (_, i) => i);
        for (let i = 0; i < index.length; i += 3) {
            const [a, b, c] = [0, 1, 2].map((j) => [p.getX(index[i + j]), p.getY(index[i + j]), p.getZ(index[i + j])]);
            const planArea = Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
            if (planArea > 1e-8 && [a, b, c].every(([x, y, z]) => Math.abs(y - roofAt(x, z)) < 1e-4)) count++; // vertical / flat slivers: not a surface
        }
    }
    return count;
}
function falseCeilingProbe(lvl, id, h, H, roofAt) {
    const faces = roomFaces(lvl);
    const top = new Mesh(faces.find((f) => f.surfaceId === id).geometry, new MeshBasicMaterial());
    const sides = faces.find((f) => f.surfaceId === `${id}~sides`);
    const sideMesh = sides && new Mesh(sides.geometry, new MeshBasicMaterial());
    const ceiling = lvl.ceilings.find((c) => c.id === id);
    const ray = new Raycaster();
    const expected = (x, z) => Math.min(H, Math.max(h, roofAt ? roofAt(x, z) : Infinity));
    let wrongTop = 0, openSide = 0;
    const xs = ceiling.points.map((p) => p[0]), zs = ceiling.points.map((p) => p[1]);
    for (let x = Math.min(...xs) + 0.013; x < Math.max(...xs); x += 0.1) for (let z = Math.min(...zs) + 0.017; z < Math.max(...zs); z += 0.1) {
        if (!pointInPolygon([x, z], ceiling.points)) continue;
        ray.set(new Vector3(x, 50, z), new Vector3(0, -1, 0)); ray.far = Infinity;
        const hit = ray.intersectObject(top, false)[0];
        // where the roof is lower than H the roof closes the volume: no top of its own there (it z-fought with the
        // roof, Flavio 26/10); below the underside the extrusion is gone anyway
        if (roofAt && roofAt(x, z) < H - 1e-6) { if (hit) wrongTop++; continue; }
        if (!hit || Math.abs(hit.point.y - expected(x, z)) > 1e-4) wrongTop++;
    }
    // along each edge, from 5 cm outside, rays inwards between the underside and the top
    ceiling.points.forEach((p, i) => {
        const q = ceiling.points[(i + 1) % ceiling.points.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        let n = [(q[1] - p[1]) / len, -(q[0] - p[0]) / len];
        if (pointInPolygon([(p[0] + q[0]) / 2 + n[0] * 1e-3, (p[1] + q[1]) / 2 + n[1] * 1e-3], ceiling.points)) n = [-n[0], -n[1]];
        for (let u = 0.02; u < 0.98; u += 0.04) {
            const e = [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
            for (let y = h + 0.005; y < expected(e[0], e[1]) - 0.005; y += 0.02) {
                ray.set(new Vector3(e[0] + n[0] * 0.05, y, e[1] + n[1] * 0.05), new Vector3(-n[0], 0, -n[1])); ray.far = 0.1;
                if (!sideMesh || !ray.intersectObject(sideMesh, false)[0]) openSide++;
            }
        }
    });
    return { wrongTop, openSide };
}
{
    const square = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
    // no roof: the 6 x 6 room, a 4 x 4 ceiling at 2.5, 30 cm thick
    const base = setCeilingHeight(addFloor(level, square, 'fc', 'ceilings'), 'fc', 2.5);
    assert.equal(setCeilingThickness(base, 'fc', -0.1), null, 'out of range');
    const thick = setCeilingThickness(base, 'fc', 0.3);
    assert.equal(thick.ceilings.at(-1).thickness, 0.3);
    assert.equal(setCeilingThickness(thick, 'fc', 0).ceilings.at(-1).thickness, undefined, '0: just the plane again');
    assert.deepEqual(falseCeilingProbe(thick, 'fc', 2.5, 2.8, null), { wrongTop: 0, openSide: 0 }, 'no roof: top at 2.80, sides closed');
    const under = roomFaces(thick).find((f) => f.surfaceId === 'fc').geometry.attributes.position;
    assert.ok(Array.from({ length: under.count }, (_, i) => under.getY(i)).some((y) => Math.abs(y - 2.5) < 1e-6), 'the underside stays at its height');
    assert.ok(near(surfaceAreas(thick)['fc~sides'], 16 * 0.3) && near(surfaceAreas(thick).fc, 16), 'bill: sides 16 m x 0.30, the ceiling its underside');
    assert.equal(surfaceLabel('fc~sides', thick), 'Ceiling 1 · sides'.replace('Ceiling 1', thick.ceilings.length > 1 ? 'Ceiling 1' : 'Ceiling'));
    assert.equal(roomFaces(base).some((f) => f.surfaceId === 'fc~sides'), false, 'no thickness: no sides');
    // UNDER A GABLE (7 x 7, eaves z = ±3.5 at 2, ridge z = 0 at 4): 2.5 + 1 m reaches above the roof near the
    // eaves (roof < 3.5 where |z| > 0.875): top and sides cut by the roof
    const gableOver = setRoofRidgeHeight(setCeilingHeight(setCeilingRoof(addFloor(thick, [[-3.5, -3.5], [3.5, -3.5], [3.5, 3.5], [-3.5, 3.5]], 'g', 'ceilings'), 'g', 'gable'), 'g', 2), 'g', 4);
    const gRoof = (x, z) => 2 + (3.5 - Math.abs(z)) * (2 / 3.5);
    const cut = setCeilingThickness(gableOver, 'fc', 1);
    assert.deepEqual(falseCeilingProbe(cut, 'fc', 2.5, 3.5, gRoof), { wrongTop: 0, openSide: 0 }, 'under a gable: top and sides cut by the roof');
    assert.equal(onRoofPlane(cut, ['fc', 'fc~sides'], gRoof), 0, 'no false ceiling triangle on the roof plane (z-fighting)');
    // exact sides area: the two edges along x at z = ±2 (roof 2.857: 0.357 high), the two along z (a trapezoid
    // profile up to 1 m where the roof is above 3.5)
    const along = 4 * (gRoof(0, 2) - 2.5);
    const across = 2 * (0.875 * 1) + 2 * ((2 - 0.875) * ((1 + (gRoof(0, 2) - 2.5)) / 2));
    assert.ok(Math.abs(surfaceAreas(cut)['fc~sides'] - 2 * (along + across)) < 0.011, `bill: the sides as cut (${surfaceAreas(cut)['fc~sides']})`);
    // an L-SHAPED (concave) false ceiling under the same roof
    const ell = setCeilingThickness(setCeilingHeight(addFloor(gableOver, [[-3, -3], [1, -3], [1, -1], [-1, -1], [-1, 2], [-3, 2]], 'fl', 'ceilings'), 'fl', 2.4), 'fl', 0.8);
    assert.deepEqual(falseCeilingProbe(ell, 'fl', 2.4, 3.2, gRoof), { wrongTop: 0, openSide: 0 }, 'L-shaped under a gable');
    // a pitched ceiling ignores the field (its roof is its top)
    assert.equal(ceilingThickness({ ...cut.ceilings.find((c) => c.id === 'g'), thickness: 1 }), 0);
}
console.log('roomLayout: ok');
