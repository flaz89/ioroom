// Self-check for minimap.js. Run: node src/plan/minimap.check.mjs
import assert from 'node:assert/strict';
import { fitMinimap, headingOf, minimapShapes } from './minimap.js';
import { DEFAULT_PLAN, activeLevel } from './planModel.js';

const base = activeLevel(DEFAULT_PLAN);
const level = { ...base, walls: base.walls.map((w) => (w.id === 'wall-back' ? { ...w, openings: [{ id: 'd', type: 'door', offset: 3, width: 0.9 }] } : w)) };
const { floors, walls, openings, bounds } = minimapShapes(level);
assert.equal(floors.length, 1);
assert.equal(walls.length, 3);
assert.equal(openings.length, 1);
// the door gap: 0.9 m along the back wall (z = -3 .. -3.15), centered on x = 0
const xs = openings[0].map((p) => p[0]), zs = openings[0].map((p) => p[1]);
assert.ok(Math.abs(Math.min(...xs) + 0.45) < 1e-9 && Math.abs(Math.max(...xs) - 0.45) < 1e-9);
assert.ok(Math.abs(Math.max(...zs) + 3) < 1e-9 && Math.abs(Math.min(...zs) + 3.15) < 1e-9);
// bounds take in the walls' thickness
assert.ok(bounds.min[1] < -3.1 && bounds.max[0] > 3.1);

// fit: the plan fills the map minus the padding, centered, +Z down
const { toMap, scale } = fitMinimap({ min: [-3, -2], max: [3, 2] }, 100, 10);
assert.equal(scale, 80 / 6);
assert.deepEqual(toMap([0, 0]), [50, 50]);
assert.deepEqual(toMap([-3, 0]), [10, 50]);
assert.ok(toMap([0, 2])[1] > 50, '+Z goes down');
// heading: a turn of `yaw` about +Y gives back yaw, also with the head tilted down (pitch about the local X)
for (const yaw of [0, 0.7, -2.5, 3]) {
    const turn = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    assert.ok(Math.abs(headingOf(turn) - yaw) < 1e-9, `yaw ${yaw}`);
    // yaw then pitch (YXZ order): q = qYaw * qPitch
    const [px, pw] = [Math.sin(-0.4 / 2), Math.cos(-0.4 / 2)];
    const [, y, , w] = turn;
    const tilted = [w * px, y * pw, -y * px, w * pw];
    assert.ok(Math.abs(headingOf(tilted) - yaw) < 1e-9, `tilted yaw ${yaw}`);
}
console.log('minimap: ok');
