// Check for roomLayout.js: node src/components/scene/level/room/roomLayout.check.mjs
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { roomFaces, surfaceAreas, surfaceLabel } from './roomLayout.js';
import { DEFAULT_PLAN, activeLevel, addFloor, addOpening, fillRoom, roofFacets, roofHeightAt, roofBeams, roofRidge, roofType, setRoofBeams, setRoofRidge, rotateRoof, setCeilingHeight, setCeilingRoof, setFloorElevation, roofPitch, setRoofRidgeHeight } from '../../../../plan/planModel.js';

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
    assert.equal(setCeilingRoof(hip, 'r', 'flat').ceilings.at(-1).roof, undefined, 'flat drops the roof');
}
console.log('roomLayout: ok');
