// Self-check for surfaceDrag.js. Run: node src/components/scene/controls/surfaceDrag.check.mjs
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, PlaneGeometry, Quaternion, Ray, Raycaster, Vector3 } from 'three';
import { startSurfaceDrag, updateSurfaceDrag, TWIST_TO_YAW } from './surfaceDrag.js';

const near = (a, b, msg, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);

// Board with a 6x6 room: floor (y=0), back wall (inner face z=-3), ceiling (y=2.7), a 1 m cube "other" at x=2
function makeBoard() {
    const board = new Group();
    const floor = new Mesh(new PlaneGeometry(6, 6)); floor.rotation.x = -Math.PI / 2;
    const wall = new Mesh(new BoxGeometry(6, 2.7, 0.15)); wall.position.set(0, 1.35, -3.075); wall.userData.surface = 'wall';
    const ceiling = new Mesh(new PlaneGeometry(6, 6)); ceiling.rotation.x = Math.PI / 2; ceiling.position.y = 2.7;
    const other = new Mesh(new BoxGeometry(1, 1, 1)); other.position.set(2, 0.5, 0);
    const target = new Group(); const body = new Mesh(new BoxGeometry(1, 1, 1)); target.add(body);
    target.position.set(0, 0.5, 0); // dragged cube resting on the floor
    board.add(floor, wall, ceiling, other, target);
    board.updateMatrixWorld(true);
    return { board, target, body };
}

// Fake XR ray pointer event from `origin` towards `aimAt` (point = first hit on `onto`, for presses)
function rayEvent(origin, aimAt, { roll = 0, onto = null, time = 0 } = {}) {
    const direction = aimAt.clone().sub(origin).normalize();
    const aim = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), direction);
    const event = {
        timeStamp: time,
        pointerQuaternion: new Quaternion().setFromAxisAngle(direction, roll).multiply(aim),
        intersection: { details: { type: 'ray' } },
        ray: new Ray(origin.clone(), direction)
    };
    if (onto) event.point = new Raycaster(origin, direction).intersectObject(onto, true)[0].point;
    return event;
}

// Keeps the pointer still for `ms` (16 ms frames) so dwell times elapse and smoothing converges
let clock = 0;
function hold(drag, target, body, origin, aimAt, ms, options = {}) {
    for (const end = clock + ms; clock < end; clock += 16) {
        updateSurfaceDrag(drag, rayEvent(origin, aimAt, { ...options, time: clock }), target, body);
    }
}
const grab = (target, body, origin, aimAt) => startSurfaceDrag(rayEvent(origin, aimAt, { onto: target, time: clock }), target, body);

const eye = new Vector3(0, 1.6, 3);

// THE BUG: grabbing a floor object with a near-horizontal ray (continuing to the back wall) keeps it on the floor
{
    const { target, body } = makeBoard();
    const aim = new Vector3(0, 0.9, 0);
    const drag = grab(target, body, eye, aim);
    hold(drag, target, body, eye, aim.clone().add(new Vector3(0.01, 0, 0)), 600);
    near(target.position.y, 0.5, 'still on the floor'); near(target.position.z, 0, 'not snapped to the wall', 0.05);
}
// Slide on the floor following the pointer
{
    const { target, body } = makeBoard();
    const drag = grab(target, body, eye, new Vector3(0, 0.5, 0.5));
    hold(drag, target, body, eye, new Vector3(-1, 0.5, 0.5), 400);
    near(target.position.y, 0.5, 'on the floor'); assert.ok(target.position.x < -0.5, 'moved left');
}
// Recenter: grabbed by its front face (center 0.5 m behind the pointer), the object glides under the pointer
{
    const { target, body } = makeBoard();
    const drag = grab(target, body, eye, new Vector3(0, 0.5, 0.5));
    hold(drag, target, body, eye, new Vector3(-1, 0.5, 0.5), 800);
    // pointer ray meets the anchor plane (y = 0.5, the grabbed height) at (-1, 0.5, 0.5): center goes there
    near(target.position.x, -1, 'centered x', 0.01); near(target.position.z, 0.5, 'centered z', 0.01);
    near(target.position.y, 0.5, 'height unchanged');
}
// A click (no motion) never moves the object, even held for a while
{
    const { target, body } = makeBoard();
    const aim = new Vector3(0, 0.5, 0.5);
    const drag = grab(target, body, eye, aim);
    hold(drag, target, body, eye, aim, 400);
    near(target.position.z, 0, 'still in place'); near(target.position.x, 0, 'still in place');
}
// Smoothing: a 2 mm jitter barely moves the object
{
    const { target, body } = makeBoard();
    const aim = new Vector3(0, 0.5, 0.5);
    const drag = grab(target, body, eye, aim);
    updateSurfaceDrag(drag, rayEvent(eye, aim.clone().add(new Vector3(0.002, 0, 0)), { time: clock }), target, body);
    assert.ok(Math.abs(target.position.x) < 0.001, `jitter damped (${target.position.x})`);
}
// Near snap needs time: a brief pass over the wall does nothing, holding it snaps onto the wall
{
    const { target, body } = makeBoard();
    target.position.set(0, 0.5, -2.3); target.updateMatrixWorld(true); // 20 cm from the wall
    const drag = grab(target, body, eye, new Vector3(0, 0.5, -1.8));
    hold(drag, target, body, eye, new Vector3(0, 1.5, -3), 100);       // brief pass
    hold(drag, target, body, eye, new Vector3(0, 0.5, -1.8), 300);     // back to the object
    near(target.position.y, 0.5, 'brief pass: still on the floor', 0.01);
    hold(drag, target, body, eye, new Vector3(0, 1.5, -3), 800);       // keep pointing at the wall
    near(target.position.z, -2.5, 'snapped onto the wall', 0.01); near(target.rotation.y, 0, 'faces into the room');
}
// Pull off a wall: pointing at the floor in front of it brings the object back (at any distance)
{
    const { target, body } = makeBoard();
    target.position.set(0, 0.5, -2.3); target.updateMatrixWorld(true);
    const drag = grab(target, body, eye, new Vector3(0, 0.5, -1.8));
    hold(drag, target, body, eye, new Vector3(0, 1.5, -3), 800);       // onto the wall
    near(target.position.z, -2.5, 'on the wall', 0.01);
    hold(drag, target, body, eye, new Vector3(0, 0, 1), 800);          // point at the floor near the user
    near(target.position.y, 0.5, 'back on the floor', 0.01);
    assert.ok(target.position.z > 0, `came back towards the user (z=${target.position.z})`);
}
// Far snap is deliberate: pointing clearly up at the ceiling and holding it hangs the object
{
    const { target, body } = makeBoard();
    const drag = grab(target, body, eye, new Vector3(0, 0.5, 0.5));
    hold(drag, target, body, eye, new Vector3(0, 2.7, 1), 300);
    assert.ok(target.position.y < 2, 'not yet (dwell)');
    hold(drag, target, body, eye, new Vector3(0, 2.7, 1), 900);
    near(target.position.y, 2.2, 'hangs from the ceiling', 0.01);
}
// Stacking: slide next to another object, point at its top -> on top; slide away -> drops to the floor
{
    const { target, body } = makeBoard();
    const drag = grab(target, body, eye, new Vector3(0, 0.5, 0.5));
    hold(drag, target, body, eye, new Vector3(1.3, 0.5, 0.5), 400);
    hold(drag, target, body, eye, new Vector3(2, 1.001, 0.2), 800);
    near(target.position.y, 1.5, 'stacked on top', 0.01);
    hold(drag, target, body, eye, new Vector3(-1, 1, 0.5), 1200);
    near(target.position.y, 0.5, 'dropped back to the floor', 0.01);
}
// Tabletop: board scaled 1:10 -> stored (local) values stay in real meters
{
    const { board, target, body } = makeBoard();
    board.position.set(0, 1, -1); board.scale.setScalar(0.1); board.updateMatrixWorld(true);
    const head = new Vector3(0, 1.6, 0);
    const drag = grab(target, body, head, new Vector3(0, 1.05, -0.95));
    hold(drag, target, body, head, new Vector3(0.1, 1.05, -0.95), 500); // 10 cm in the world
    near(target.position.x, 1, '1 m in the model', 0.02); near(target.position.y, 0.5, 'still on the model floor');
}
// Wrist twist (beyond the dead zone) turns the object, upright; tiny rolls do nothing
{
    const { target, body } = makeBoard();
    const aim = new Vector3(0, 0.5, 0.5);
    const drag = grab(target, body, eye, aim);
    hold(drag, target, body, eye, aim, 300, { roll: 0.1 });
    near(target.rotation.y, 0, 'dead zone');
    hold(drag, target, body, eye, aim, 600, { roll: 0.4 });
    near(Math.abs(target.rotation.y), (0.4 - (8 * Math.PI) / 180) * TWIST_TO_YAW, 'yaw from twist', 0.01);
    near(target.rotation.x, 0, 'upright');
}
// Pull the rope: on the wall, a quick hand pull back along the ray reels the object onto the floor
// towards the user; the same pull done slowly (hand drift) does nothing
for (const [ms, detaches] of [[150, true], [2000, false]]) {
    const { target, body } = makeBoard();
    target.position.set(0, 0.5, -2.3); target.updateMatrixWorld(true);
    const drag = grab(target, body, eye, new Vector3(0, 0.5, -1.8));
    hold(drag, target, body, eye, new Vector3(0, 1.5, -3), 800);       // onto the wall
    const aim = new Vector3(0, 1.5, -3);
    const direction = aim.clone().sub(eye).normalize();
    for (const end = clock + ms; clock < end; clock += 16) {           // pull the hand back 15 cm
        const origin = eye.clone().addScaledVector(direction, -0.15 * (1 - (end - clock) / ms));
        updateSurfaceDrag(drag, rayEvent(origin, origin.clone().add(direction), { time: clock }), target, body);
    }
    const origin = eye.clone().addScaledVector(direction, -0.15);
    hold(drag, target, body, origin, origin.clone().add(direction), 400);
    if (detaches) {
        near(target.position.y, 0.5, 'reeled onto the floor', 0.01);
        assert.ok(target.position.z > -1, `came towards the user (z=${target.position.z})`);
    } else {
        near(target.position.z, -2.5, 'slow drift: still on the wall', 0.01);
    }
}
// Push away a near object: tilting the ray up past the horizon keeps pushing it, never jumps back
{
    const { target, body } = makeBoard();
    target.position.set(0, 0.5, 2.3); target.updateMatrixWorld(true);  // 70 cm in front of the user
    const hand = new Vector3(0, 1.2, 3);
    const drag = grab(target, body, hand, new Vector3(0, 0.6, 2.4));
    hold(drag, target, body, hand, hand.clone().add(new Vector3(0, Math.sin(-0.7), -Math.cos(-0.7))), 1000);
    let previous = target.position.z;
    for (let pitch = -0.7; pitch <= 0.3; pitch += 0.02) {                // from down at it to above the horizon
        hold(drag, target, body, hand, hand.clone().add(new Vector3(0, Math.sin(pitch), -Math.cos(pitch))), 32);
        assert.ok(target.position.z <= previous + 1e-3, `no jump back (pitch ${pitch.toFixed(2)}: ${target.position.z} > ${previous})`);
        previous = target.position.z;
    }
    hold(drag, target, body, hand, hand.clone().add(new Vector3(0, 0.3, -1)), 600);
    assert.ok(target.position.z < 0.5, `pushed far away (z=${target.position.z})`);
    near(target.position.y, 0.5, 'still on the floor');
}
// Room bounds: pointing past the open side of the room keeps the object on the floor, sliding along the edge
{
    const { target, body } = makeBoard();
    const outside = new Vector3(0, 1.6, 5);                              // user standing outside the room
    const drag = grab(target, body, outside, new Vector3(0, 0.5, 0.5));
    hold(drag, target, body, outside, new Vector3(-1, 0, 4.5), 800);     // floor ends at z = 3
    assert.ok(target.position.z <= 3, `stays over the floor (z=${target.position.z})`);
    assert.ok(target.position.x < -0.5, `slides along the edge (x=${target.position.x})`);
    near(target.position.y, 0.5, 'still on the floor');
}
// Grid snap: the position lands on 10 cm cells, the wrist twist on 15° steps; a still hold never moves
{
    const { target, body } = makeBoard();
    const aim = new Vector3(0, 0.5, 0.5);
    const drag = startSurfaceDrag(rayEvent(eye, aim, { onto: target, time: clock }), target, body, { gridStep: 0.1 });
    hold(drag, target, body, eye, aim, 300);
    near(target.position.x, 0, 'click: not moved');
    hold(drag, target, body, eye, new Vector3(-0.537, 0.5, 0.31), 800, { roll: 0.5 });
    const onGrid = (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-3;
    assert.ok(onGrid(target.position.x) && onGrid(target.position.z), `on the grid (${target.position.x}, ${target.position.z})`);
    near(target.position.y, 0.5, 'still on the floor');
    const steps = target.rotation.y / ((15 * Math.PI) / 180);
    near(steps, Math.round(steps), 'yaw on 15° steps'); assert.ok(Math.round(steps) !== 0, 'twist still turns it');
}
console.log('surfaceDrag: ok');
