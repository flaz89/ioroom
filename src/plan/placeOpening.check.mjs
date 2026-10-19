// node src/plan/placeOpening.check.mjs — door / window tool (placeOpening.js) on synthetic plans
import assert from 'node:assert/strict';
import { placeOpening } from './placeOpening.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;
const level = (walls) => ({ wallHeight: 2.7, floors: [], walls });

// A. a full (traced) wall over a window: jambs across the wall at x = 2 and 3.2, a short frame tick inside
{
    const plan = level([{ id: 'top', a: [0, -0.15], b: [6, -0.15], thickness: 0.3, align: 'center' }]);
    const drawing = [
        [[0, 0], [6, 0]], [[0, -0.3], [6, -0.3]],          // faces (glass / frame lines run on: one face)
        [[2, 0], [2, -0.3]], [[3.2, 0], [3.2, -0.3]],      // jambs
        [[2.05, -0.1], [2.05, -0.2]],                      // frame tick: does not span the wall
        [[0, 0], [0, -0.3]]                                // the wall's end cap: not a jamb
    ];
    const result = placeOpening(plan, [2.6, -0.15], 'window', drawing, 0.05, { opening: 'o1' });
    const opening = result.level.walls[0].openings[0];
    assert.equal(result.wallId, 'top');
    assert.equal(result.removedWallId, null);
    assert.ok(close(opening.offset, 2.6) && close(opening.width, 1.2) && opening.type === 'window' && opening.sill === 0.9);
    // the same click again: it would overlap the window -> nothing
    assert.equal(placeOpening(result.level, [2.6, -0.15], 'window', drawing, 0.05), null);
    // no jamb on one side (point between the end cap and the first jamb): nothing
    assert.equal(placeOpening(plan, [1, -0.15], 'window', drawing, 0.05), null);
    // no drawing: nothing on a wall
    assert.equal(placeOpening(plan, [2.6, -0.15], 'door', [], 0.05), null);
}

// B. a door gap between two traced pieces on one axis (z = 4.15): merged, the gap becomes the door
{
    const plan = level([
        { id: 'west', a: [-0.15, 4.15], b: [2, 4.15], thickness: 0.3, align: 'center', openings: [{ id: 'w1', type: 'window', offset: 1, width: 0.8, height: 1.4, sill: 0.9 }] },
        { id: 'east', a: [6.15, 4.15], b: [2.9, 4.15], thickness: 0.3, align: 'center', openings: [{ id: 'e1', type: 'window', offset: 1, width: 0.8, height: 1.4, sill: 0.9 }] },
        { id: 'side', a: [6.15, -0.15], b: [6.15, 4.15], thickness: 0.3, align: 'center' } // joined at east's far end
    ]);
    const result = placeOpening(plan, [2.45, 4.1], 'door', [], 0.05, { opening: 'd1' });
    assert.equal(result.removedWallId, 'east');
    assert.equal(result.level.walls.length, 2);
    const wall = result.level.walls.find((w) => w.id === 'west');
    assert.deepEqual([wall.a, wall.b], [[-0.15, 4.15], [6.15, 4.15]]); // the far end is the joined corner, exactly
    const byId = Object.fromEntries(wall.openings.map((o) => [o.id, o]));
    assert.ok(close(byId.d1.offset, 2.6) && close(byId.d1.width, 0.9) && byId.d1.sill === 0);
    assert.ok(close(byId.w1.offset, 1));             // the first wall's window stays put
    assert.ok(close(byId.e1.offset, 6.3 - 1));       // the second wall's window keeps its place in the world (x = 5.15)
    // a gap too wide for an opening (> 3 m) or no gap under the point: nothing
    const far = level([plan.walls[0], { ...plan.walls[1], b: [5.5, 4.15], openings: [] }]);
    assert.equal(placeOpening(far, [3, 4.15], 'door', [], 0.05), null);
    assert.equal(placeOpening(plan, [2.45, 3], 'door', [], 0.05), null);
}

// a 9 cm gap (a frame detail broke the trace): the walls are joined, no opening
{
    const plan = level([
        { id: 'a', a: [0, 0], b: [2, 0], thickness: 0.2, align: 'center' },
        { id: 'b', a: [2.09, 0], b: [5, 0], thickness: 0.2, align: 'center' }
    ]);
    const result = placeOpening(plan, [2.05, 0.03], 'door', [], 0.05);
    assert.equal(result.openingId, null);
    assert.equal(result.removedWallId, 'b');
    assert.deepEqual(result.level.walls[0].b, [5, 0]);
    assert.equal((result.level.walls[0].openings ?? []).length, 0);
}

// C. a door right after a corner: the wall stops at the jamb (x = 2.07), the wall across (axis x = 0,
// faces at ±0.1) ends at z = 0.15; a click in the gap: the wall runs on to it (L corner) and the door fills
// the gap from the near face (x = 0.1) to the old end
{
    const plan = level([
        { id: 'w', a: [2.07, 0.075], b: [6, 0.075], thickness: 0.15, align: 'center', openings: [{ id: 'win', type: 'window', offset: 2, width: 1, height: 1.4, sill: 0.9 }] },
        { id: 'x', a: [0, -3], b: [0, 0.15], thickness: 0.2, align: 'center' }
    ]);
    const result = placeOpening(plan, [1, 0.08], 'door', [], 0.05, { opening: 'd' });
    const wall = result.level.walls.find((item) => item.id === 'w');
    const across = result.level.walls.find((item) => item.id === 'x');
    assert.deepEqual(wall.a, [0, 0.075]);                        // runs on to the other wall's axis
    assert.deepEqual(across.b, [0, 0.075]);                      // L corner: that wall's end moved there too
    const byId = Object.fromEntries(wall.openings.map((o) => [o.id, o]));
    assert.ok(close(byId.d.width, 1.97) && close(byId.d.offset, 0.1 + 1.97 / 2), `${byId.d.width} ${byId.d.offset}`);
    assert.ok(close(byId.win.offset, 4.07));                     // the window keeps its place (x = 4.07)
    // past the other wall, or too far (> 3 m): nothing
    assert.equal(placeOpening(plan, [-0.5, 0.08], 'door', [], 0.05), null);
}

// B / C with the drawing's jambs INSIDE the gap (masonry beside the frame not traced): the door is narrowed to
// them, the rest of the gap becomes wall
{
    const plan = level([
        { id: 'w', a: [2.07, 0.075], b: [6, 0.075], thickness: 0.15, align: 'center' },
        { id: 'x', a: [0, -3], b: [0, 0.15], thickness: 0.2, align: 'center' }
    ]);
    const jambs = [[[0.3, 0], [0.3, 0.15]], [[1.2, 0], [1.2, 0.15]]];
    const result = placeOpening(plan, [0.8, 0.08], 'door', jambs, 0.05, { opening: 'd' });
    const door = result.level.walls.find((item) => item.id === 'w').openings[0];
    assert.ok(close(door.width, 0.9) && close(door.offset, 0.75), `${door.width} ${door.offset}`);
}
// C blocked: a niche's return across the way between the wall's end and the point -> not through it
{
    const plan = level([
        { id: 'w', a: [3, 0], b: [6, 0], thickness: 0.2, align: 'center' },
        { id: 'top', a: [0, -3], b: [0, 3], thickness: 0.2, align: 'center' },      // the far wall
        { id: 'niche', a: [1.5, -2], b: [1.5, 0.3], thickness: 0.2, align: 'center' } // across the way, at x = 1.5
    ]);
    assert.equal(placeOpening(plan, [0.8, 0], 'door', [], 0.05), null);           // beyond the niche: nothing
    const near = placeOpening(plan, [2.2, 0], 'door', [], 0.05, { opening: 'd' }); // before it: up to its face
    assert.ok(close(near.level.walls.find((item) => item.id === 'w').openings[0].width, 3 - 1.6));
}

// B with walls drawn on different lines: the second one side-aligned (its drawn line is a face, 10 cm off the
// shared axis): the merged wall stays on the first one's line, straight; the wall joined at the far end follows
{
    const plan = level([
        { id: 'a', a: [0, 0], b: [2, 0], thickness: 0.2, align: 'center' },
        { id: 'b', a: [6, -0.1], b: [3, -0.1], thickness: 0.2 },                     // axis z = 0, line z = -0.1
        { id: 'side', a: [6, -3], b: [6, -0.1], thickness: 0.2, align: 'center' }    // joined at b's far end
    ]);
    const result = placeOpening(plan, [2.5, 0], 'door', [], 0.05, { opening: 'd' });
    const wall = result.level.walls.find((item) => item.id === 'a');
    assert.deepEqual([wall.a, wall.b], [[0, 0], [6, 0]]);
    assert.deepEqual(result.level.walls.find((item) => item.id === 'side').b, [6, 0]);
}

// a door frame drawn as boxes of lines across the wall INSIDE the gap (the traced walls end at the masonry,
// x = 2 and 3): the opening is the whole gap, the frame stays in it
{
    const plan = level([
        { id: 'l', a: [0, 0], b: [2, 0], thickness: 0.2, align: 'center' },
        { id: 'r', a: [3, 0], b: [5, 0], thickness: 0.2, align: 'center' }
    ]);
    const frame = [2, 2.03, 2.06, 2.94, 2.97, 3].map((x) => [[x, -0.1], [x, 0.1]]);
    const result = placeOpening(plan, [2.5, 0], 'door', frame, 0.05, { opening: 'd' });
    const door = result.level.walls[0].openings[0];
    assert.ok(close(door.width, 1) && close(door.offset, 2.5), `${door.width} ${door.offset}`);
}
// B: a wall running on straight at the far vertex keeps its end (not slanted); a wall arriving across moves
{
    const plan = level([
        { id: 'a', a: [0, 0], b: [2, 0], thickness: 0.2, align: 'center' },
        { id: 'b', a: [6, -0.1], b: [3, -0.1], thickness: 0.2 },                     // line z = -0.1, axis z = 0
        { id: 'on', a: [6, -0.1], b: [9, -0.1], thickness: 0.2 },                    // straight on from b's far end
        { id: 'up', a: [6, -3], b: [6, -0.1], thickness: 0.2, align: 'center' }      // across
    ]);
    const result = placeOpening(plan, [2.5, 0], 'door', [], 0.05, { opening: 'd' });
    assert.deepEqual(result.level.walls.find((w) => w.id === 'on').a, [6, -0.1]);
    assert.deepEqual(result.level.walls.find((w) => w.id === 'up').b, [6, 0]);
}

// B where both walls end in L CORNERS with walls going up (corner vertices on the uprights' axes x = 0 and
// x = 3, uprights 0.2 thick): the gap runs face to face (0.1 .. 2.9), the frame lines at the faces mark the
// masonry, the frame stays in the door
{
    const plan = level([
        { id: 'l', a: [-2, 0], b: [0, 0], thickness: 0.2, align: 'center' },
        { id: 'lu', a: [0, 0], b: [0, -3], thickness: 0.2, align: 'center' },
        { id: 'r', a: [3, 0], b: [5, 0], thickness: 0.2, align: 'center' },
        { id: 'ru', a: [3, 0], b: [3, -3], thickness: 0.2, align: 'center' }
    ]);
    const frame = [0.1, 0.14, 0.18, 2.82, 2.86, 2.9].map((x) => [[x, -0.1], [x, 0.1]]);
    const result = placeOpening(plan, [1.5, 0], 'door', frame, 0.05, { opening: 'd' });
    const wall = result.level.walls.find((w) => w.id === 'l');
    const door = wall.openings[0];
    const axisStart = wall.a[0]; // -2
    assert.ok(close(door.width, 2.8) && close(axisStart + door.offset, 1.5), `${door.width} ${door.offset}`);
}

console.log('placeOpening: ok');
