// Self-check for fistGesture.js. Run: node src/components/scene/xr-ui/fistGesture.check.mjs
import assert from 'node:assert/strict';
import { createFistGesture, isDeletePose } from './fistGesture.js';

const OPEN = 1.9, HALF = 1.4, FIST = 1.1;

// Open long enough -> armed -> quick fist -> fire (once)
{
    const g = createFistGesture();
    assert.equal(g(0, OPEN, true), null, 'not armed yet');
    assert.equal(g(450, OPEN, true), 'armed');
    assert.equal(g(600, HALF, true), 'armed', 'closing keeps it armed');
    assert.equal(g(700, FIST, true), 'fire');
    assert.equal(g(800, FIST, true), null, 'fires only once');
}
// Slow close -> nothing
{
    const g = createFistGesture();
    g(0, OPEN, true); g(450, OPEN, true);
    assert.equal(g(1200, HALF, true), null, 'window expired');
    assert.equal(g(1300, FIST, true), null);
}
// Quick open/close without holding open (e.g. after releasing a grab) -> nothing
{
    const g = createFistGesture();
    g(0, OPEN, true);
    assert.equal(g(200, FIST, true), null);
}
// Nothing selected -> never arms
{
    const g = createFistGesture();
    g(0, OPEN, false); 
    assert.equal(g(500, OPEN, false), null);
    assert.equal(g(600, FIST, false), null);
}
// Delete pose: fingers up + back of the hand towards the user
{
    assert.equal(isDeletePose(0.95, 0.95, false), true, 'fingers up, back to the user');
    assert.equal(isDeletePose(-0.95, 0.95, false), false, 'fingers down');
    assert.equal(isDeletePose(0.95, 0.05, false), false, 'hand sideways (karate chop)');
    assert.equal(isDeletePose(0.95, -0.95, false), false, 'palm towards the user (wrist menu)');
    assert.equal(isDeletePose(0.1, 0.95, false), false, 'palm parallel to the floor');
    assert.equal(isDeletePose(0.7, 0.6, false), false, 'not yet in the pose');
    assert.equal(isDeletePose(0.7, 0.6, true), true, 'hysteresis keeps it while closing');
    assert.equal(isDeletePose(0.5, 0.6, true), false, 'fingers tilted away');
}
console.log('fistGesture: ok');
