import { Box3, Matrix4, Plane, Quaternion, Ray, Raycaster, Vector3 } from 'three';
import { getPointerRay } from './pointerRay.js';

/*
* Surface-aware ray drag (mouse, controller ray, hand-ray pinch) — "The Sims" style.
*
* 1. SUPPORT: at grab time the surface the object rests on is detected (floor, wall, ceiling,
*    top/side of another object). Floating objects use a horizontal support at their bottom.
* 2. SLIDE: the object slides on a plane parallel to its support, through the grabbed point, so it
*    never jumps on grab and keeps touching its support. If the ray is almost parallel to that plane,
*    the pointer is followed at the grab distance instead (no runaway at grazing angles).
* 3. TAKEOVER (snap) onto another surface, never instantly:
*    - NEAR snap: the object is within SNAP_DISTANCE of that surface and the user points at it
*      (or it touches it), continuously for SNAP_DWELL_MS;
*    - FAR snap (deliberate): the ray points clearly away from the support plane (> FAR_SNAP_ANGLE,
*      e.g. up at a wall or the ceiling) and stays on that surface for FAR_SNAP_DWELL_MS;
*    - PULL OFF a wall: on a vertical support, pointing at a horizontal surface in front of it
*      (floor, a table top) for SNAP_DWELL_MS brings the object there, at any distance.
*    Otherwise the object keeps sliding; if the ray hits a surface before the slide point, the object
*    stops at its foot instead of passing through it. The far wall behind an object never steals it.
* 6. RECENTER: on horizontal supports, once the pointer actually moves, the sideways offset between
*    the grabbed point and the object's center fades out (RECENTER_TIME_MS), so the object glides
*    under the pointer instead of trailing it by the grab offset.
* 5. SMOOTHING: speed-adaptive low-pass on the final pose (one-euro style): hand jitter and small
*    slow motions are damped, large deliberate motions stay responsive, snaps become short glides.
* 4. DROP: an object slid off a raised horizontal support (a table, another object) falls onto the
*    surface below.
* 8. GRID SNAP (optional, `gridStep` option): once the drag really started, the position snaps to a
*    grid along the support plane (board space, so cells are real meters at any tabletop scale) and,
*    on horizontal supports, the yaw snaps to YAW_SNAP steps. Smoothing turns cell jumps into glides.
* 7. PULL THE ROPE (XR rays): on a wall, a quick pull of the hand back along the ray detaches the
*    object and reels it towards the user, onto the surface below that point (usually the floor).
*    Only quick pulls count (leaky reference, PULL_WINDOW_MS), so slow hand drift never detaches.
*
* Placement rules: objects always stay upright (yaw only); on ROOM walls (userData.surface === 'wall')
* they turn their front away from the wall; on horizontal supports, twisting the wrist around the
* ray turns them (XR rays only). Vertical faces of other objects are never supports (no sticking).
* All math runs in the parent (board) space, where surfaces are axis-aligned, so it works the same
* at 1:1 and inside the scaled tabletop model.
*/

// Calibration knobs (meters in model space, ms; tune on the headset)
export const TWIST_TO_YAW = 1;                       // wrist twist around the ray -> yaw (flip sign if inverted)
const TWIST_DEADZONE = (8 * Math.PI) / 180;          // wrist rolls smaller than this do not rotate
const SUPPORT_TOLERANCE = 0.05;                      // max gap to consider the object resting on a surface
const CONTACT_DISTANCE = 0.05;                       // object this close to a surface = touching it
const SNAP_DISTANCE = 0.3;                           // NEAR snap only within this distance of the new surface
const SNAP_DWELL_MS = 200;                           // NEAR snap condition must hold this long
const FAR_SNAP_ANGLE = Math.sin((20 * Math.PI) / 180); // ray this far away from the support plane = deliberate
const FAR_SNAP_DWELL_MS = 500;                       // FAR snap: keep pointing at the surface this long
const TAKEOVER_MARGIN = 0.05;                        // a hit must be this much before the slide point
const MAX_SLIDE_FACTOR = 2.5;                        // slide at most this × grab distance away (less sensitive)
const MIN_REACH = 3;                                // ...but always at least this far (near grabs can still push far)
const HORIZONTAL_NORMAL_Y = 0.5;                     // |normal.y| above this = horizontal surface
const SMOOTHING_MIN_ALPHA = 0.18;                    // smoothing of tiny/slow motions (lower = smoother)
const SMOOTHING_FAST_SPEED = 0.06;                   // motions of this size per update follow almost 1:1
const RECENTER_TIME_MS = 120;                        // time constant of the recentering under the pointer
const MOVE_THRESHOLD = 0.01;                         // pointer motion that starts the drag (a click never moves)
const PULL_DISTANCE = 0.08;                          // WORLD meters of quick hand pull that detach from a wall
const PULL_WINDOW_MS = 300;                          // pull reference forgets older motion (higher = slower pulls count)
const REEL_FACTOR = 0.5;                             // after the pull the object lands at this × its distance
const YAW_SNAP = (15 * Math.PI) / 180;              // yaw step when grid snap is on

const AXES = [
    new Vector3(0, -1, 0), new Vector3(0, 1, 0),
    new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
    new Vector3(0, 0, 1), new Vector3(0, 0, -1)
];

const _raycaster = new Raycaster();
const _worldRay = new Ray();
const _localRay = new Ray();
const _parentInverse = new Matrix4();
const _parentQuaternion = new Quaternion();
const _box = new Box3();
const _center = new Vector3();
const _size = new Vector3();
const _point = new Vector3();
const _slide = new Vector3();
const _corner = new Vector3();
const _direction = new Vector3();
const _delta = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _candidates = [];
const _previousPosition = new Vector3();
const _previousQuaternion = new Quaternion();
const _pull = new Vector3();

// Ray-based pointers ('screen-ray' = mouse/touch, 'ray' = XR controller/hand ray). 'sphere' = near grab/touch.
export function isRayPointer(event) {
    const type = event?.intersection?.details?.type;
    return type === 'ray' || type === 'screen-ray';
}

// Surfaces an object can be placed on: meshes inside `root`, excluding the dragged subtree
// (object + its gizmo/outline) and wide lines (gizmo helpers; they also need a camera to raycast).
function collectSurfaces(root, dragged) {
    _candidates.length = 0;
    root.traverse((object) => {
        if (object.isMesh && !object.isLineSegments2) _candidates.push(object);
    });
    return _candidates.filter((object) => {
        for (let o = object; o != null && o !== root; o = o.parent) if (o === dragged) return false;
        return true;
    });
}

// Snap a parent-space normal to its dominant axis: room surfaces are axis-aligned, and curved
// objects (sphere, torus) would otherwise tilt the placement direction.
function snapToAxis(normal) {
    const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
    if (ay >= ax && ay >= az) return normal.set(0, Math.sign(normal.y), 0);
    if (ax >= az) return normal.set(Math.sign(normal.x), 0, 0);
    return normal.set(0, 0, Math.sign(normal.z));
}

// Signed twist angle of quaternion q around unit axis (swing-twist decomposition)
function twistAngle(q, axis) {
    let angle = 2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w);
    if (angle > Math.PI) angle -= 2 * Math.PI;
    if (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
}

/*
* First surface along a WORLD ray, excluding the dragged object. Returns parent-space
* { point, normal (snapped), distance, isWall } or null.
*/
function castSurface(parent, target, worldRay) {
    _raycaster.ray.copy(worldRay);
    const hit = _raycaster.intersectObjects(collectSurfaces(parent, target), false).find((h) => h.face != null);
    if (hit == null) return null;
    parent.getWorldQuaternion(_parentQuaternion).invert();
    const point = parent.worldToLocal(hit.point.clone());
    const normal = snapToAxis(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).applyQuaternion(_parentQuaternion));
    const origin = parent.worldToLocal(worldRay.origin.clone());
    return { point, normal, distance: origin.distanceTo(point), isWall: hit.object.userData?.surface === 'wall' };
}

// Body bounds in parent space
function bodyBox(parent, body, target) {
    target.updateWorldMatrix(false, true);
    _box.setFromObject(body);
    return _box.applyMatrix4(_parentInverse.copy(parent.matrixWorld).invert());
}

// Pointer ray in parent space (and the world ray in _worldRay)
function localRay(event, parent) {
    _worldRay.copy(getPointerRay(event));
    _localRay.copy(_worldRay).applyMatrix4(_parentInverse.copy(parent.matrixWorld).invert());
    _localRay.direction.normalize();
    return _localRay;
}

/*
* Rests the target on a surface: upright yaw, then pushed out along the normal until its bounds
* just touch the plane through `point`.
*/
function placeOn(target, body, point, normal, yaw) {
    const parent = target.parent;
    target.quaternion.setFromAxisAngle(_up, yaw);
    target.position.copy(point);
    const box = bodyBox(parent, body, target);
    let minProjection = Infinity;
    for (let i = 0; i < 8; i++) {
        _corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        minProjection = Math.min(minProjection, _corner.dot(normal));
    }
    target.position.addScaledVector(normal, point.dot(normal) - minProjection);
}

/*
* Surface straight below the body center, or null. Returns the parent-space hit ({ point, normal, ... })
* plus `box`: the parent-space body bounds (a shared temporary, valid until the next call).
* Used by the DROP rule and by the drag footprint (helpers/DragFootprint.jsx).
*/
export function surfaceBelow(target, body = target) {
    const parent = target.parent;
    if (parent == null) return null;
    const box = bodyBox(parent, body, target);
    box.getCenter(_center);
    _worldRay.origin.copy(_center).applyMatrix4(parent.matrixWorld);
    _worldRay.direction.copy(_up).negate().transformDirection(parent.matrixWorld);
    const hit = castSurface(parent, target, _worldRay);
    if (hit != null) hit.box = box;
    return hit;
}

const _candidate = new Vector3();

/*
* GRID SNAP: rounds the position along the support plane to multiples of `step` (the axis along the
* support normal is left alone, so the object keeps touching its support) and, on horizontal
* supports, the yaw to YAW_SNAP. Objects stay upright, so the yaw is read straight from the quaternion.
*/
function snapToGrid(target, normal, step) {
    if (Math.abs(normal.x) < 0.5) target.position.x = Math.round(target.position.x / step) * step;
    if (Math.abs(normal.y) < 0.5) target.position.y = Math.round(target.position.y / step) * step;
    if (Math.abs(normal.z) < 0.5) target.position.z = Math.round(target.position.z / step) * step;
    if (Math.abs(normal.y) > HORIZONTAL_NORMAL_Y) {
        const yaw = 2 * Math.atan2(target.quaternion.y, target.quaternion.w);
        target.quaternion.setFromAxisAngle(_up, Math.round(yaw / YAW_SNAP) * YAW_SNAP);
    }
}

/*
* ROOM BOUNDS, shape-agnostic: the object's center must stay above some surface (floor, a table...).
* If the new position has nothing below, it slides along the edge (keeps the free axis) or goes back
* to `fallback`. Works for any floor outline (future rooms built from drawings/plans), no box limits.
* A fallback that is itself outside (legacy data) never traps the object. Returns false if moved back.
* ponytail: tests the center only, so up to half an object can overhang the edge; test the bounds'
* corners if that matters.
*/
export function keepOverSurface(target, body, fallback) {
    if (surfaceBelow(target, body) != null) return true;
    _candidate.copy(target.position);
    target.position.set(_candidate.x, _candidate.y, fallback.z);   // slide along an edge parallel to X
    if (surfaceBelow(target, body) != null) return false;
    target.position.set(fallback.x, _candidate.y, _candidate.z);   // slide along an edge parallel to Z
    if (surfaceBelow(target, body) != null) return false;
    target.position.copy(fallback);
    if (surfaceBelow(target, body) != null) return false;
    target.position.copy(_candidate);                               // nowhere valid: don't trap it
    return true;
}

// Re-anchors the drag on a support plane after a takeover (pointer currently at `anchorPoint`)
function setSupport(drag, target, normal, supportPoint, anchorPoint, event) {
    drag.supportNormal.copy(normal);
    drag.supportPlane.setFromNormalAndCoplanarPoint(normal, supportPoint);
    drag.anchorPlane.setFromNormalAndCoplanarPoint(normal, anchorPoint);
    drag.offset.copy(target.position).sub(anchorPoint);
    drag.grabAnchor.copy(anchorPoint);
    drag.grabDistance = Math.max(_localRay.origin.distanceTo(anchorPoint), 1e-3);
    drag.yaw = target.rotation.y;
    drag.twistReference.copy(event.pointerQuaternion).invert();
    drag.pullOrigin.copy(_worldRay.origin);
}

/*
* Captures the state at press time (never moves the target).
* body: the object whose bounds touch surfaces (the mesh), so gizmo handles/outlines never count.
* options.gridStep: grid cell size (parent-space meters) to snap to, 0 = free placement.
*/
export function startSurfaceDrag(event, target, body = target, { gridStep = 0 } = {}) {
    const parent = target.parent;
    const drag = {
        useTwist: event.intersection?.details?.type === 'ray',
        smooth: event.intersection?.details?.type === 'ray', // XR rays jitter; a mouse is precise (no lag)
        reel: event.intersection?.details?.type === 'ray',   // "pull the rope" off walls (XR rays only)
        pullOrigin: new Vector3(), // WORLD ray origin the hand pull is measured from (leaky)
        gridStep,          // grid snap cell size, 0 = off
        twistReference: new Quaternion(),
        yaw: target.rotation.y,
        supportNormal: new Vector3(0, 1, 0),
        supportPlane: new Plane(),
        anchorPlane: new Plane(),
        offset: new Vector3(),
        grabDistance: 1,
        pending: null,     // snap candidate being confirmed: { key, since }
        grabAnchor: new Vector3(), // anchor point at grab/snap time (detects the first real motion)
        moved: false,      // the pointer moved beyond MOVE_THRESHOLD since the grab
        lastTime: null     // previous update time (ms), for time-based recentering
    };
    if (parent == null) return drag;
    parent.updateWorldMatrix(true, false);
    localRay(event, parent);

    // SUPPORT: the closest surface touching the body along the 6 axes (default: horizontal, at the bottom)
    const box = bodyBox(parent, body, target);
    box.getCenter(_center);
    box.getSize(_size).multiplyScalar(0.5);
    let support = null;
    let bestGap = SUPPORT_TOLERANCE;
    for (const axis of AXES) {
        _worldRay.origin.copy(_center).applyMatrix4(parent.matrixWorld);
        _worldRay.direction.copy(axis).transformDirection(parent.matrixWorld);
        const hit = castSurface(parent, target, _worldRay);
        if (hit == null) continue;
        const gap = hit.distance - Math.abs(axis.dot(_size));
        if (gap <= bestGap) { bestGap = gap; support = { normal: axis.clone().negate(), point: hit.point }; }
    }
    if (support == null) support = { normal: new Vector3(0, 1, 0), point: new Vector3(_center.x, box.min.y, _center.z) };

    // ANCHOR: the grabbed point on the object (event.point), on a plane parallel to the support
    localRay(event, parent);
    const grabPoint = parent.worldToLocal(event.point.clone());
    setSupport(drag, target, support.normal, support.point, grabPoint, event);
    return drag;
}

// Distance between the body bounds and the plane of a surface hit (0 when touching or crossing it)
function distanceToSurfacePlane(box, hit) {
    let minProjection = Infinity;
    for (let i = 0; i < 8; i++) {
        _corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        minProjection = Math.min(minProjection, _corner.dot(hit.normal));
    }
    return Math.max(0, minProjection - hit.point.dot(hit.normal));
}

// Twist angle with a dead zone (small wrist rolls are ignored, then rotation continues smoothly)
function twistWithDeadzone(angle) {
    if (Math.abs(angle) <= TWIST_DEADZONE) return 0;
    return angle - Math.sign(angle) * TWIST_DEADZONE;
}

/*
* Moves the target for the latest pointer event. Returns false when nothing changed.
* The target must be a direct child of the space to place in (the board).
* now (ms): current time for the snap dwell times. Call it every frame while held (re-using the
* last pointer event when there is no new one) so dwells and smoothing progress with a still pointer.
*/
export function updateSurfaceDrag(drag, event, target, body = target, now = event.timeStamp ?? performance.now()) {
    const parent = target.parent;
    if (parent == null) return false;
    parent.updateWorldMatrix(true, false);
    const ray = localRay(event, parent);

    // The pose is computed on the target ("desired"), then blended from the previous one (smoothing)
    _previousPosition.copy(target.position);
    _previousQuaternion.copy(target.quaternion);

    // SLIDE target point: anchor plane hit, capped at the max reach. A ray that misses the plane (aimed
    // above its horizon) is at the cap too: it is the limit of a ray tilting up, so the object stays far
    // instead of jumping back to the grab distance (continuous push away).
    const reach = Math.max(drag.grabDistance * MAX_SLIDE_FACTOR, MIN_REACH);
    let slideDistance = ray.distanceToPlane(drag.anchorPlane);
    if (slideDistance == null || slideDistance > reach) {
        // Same distance along the plane as the hit at the cap, in the ray's direction on the plane:
        // continuous at the cap and constant above the horizon (tilting further up never pulls back)
        drag.anchorPlane.projectPoint(ray.origin, _slide);
        const height = ray.origin.distanceTo(_slide);
        _direction.copy(ray.direction).addScaledVector(drag.anchorPlane.normal, -ray.direction.dot(drag.anchorPlane.normal));
        if (_direction.lengthSq() > 1e-6) {
            _slide.addScaledVector(_direction.normalize(), Math.sqrt(Math.max(reach * reach - height * height, 0)));
        } else {
            ray.at(reach, _slide); // ray perpendicular to the plane: no direction on it
            drag.anchorPlane.projectPoint(_slide, _slide);
        }
        slideDistance = ray.origin.distanceTo(_slide);
    } else {
        ray.at(slideDistance, _slide);
    }

    // Vertical faces of objects are never supports (furniture pushed together must not stick side by side):
    // only room walls and horizontal surfaces (floor, tops, ceiling) can take the object over
    let hit = castSurface(parent, target, _worldRay);
    if (hit != null && !(hit.isWall || Math.abs(hit.normal.y) > HORIZONTAL_NORMAL_Y)) hit = null;
    const onSupport = hit != null && hit.normal.equals(drag.supportNormal)
        && Math.abs(drag.supportPlane.distanceToPoint(hit.point)) < SUPPORT_TOLERANCE;
    const pointedAt = hit != null && hit.distance < slideDistance - TAKEOVER_MARGIN;

    // Don't pass through what the ray hits first: stop at its foot on the anchor plane
    if (pointedAt && !onSupport) drag.anchorPlane.projectPoint(hit.point, _slide);

    // RECENTER: fade the sideways grab offset on horizontal supports once the drag really started
    if (!drag.moved && _slide.distanceTo(drag.grabAnchor) > MOVE_THRESHOLD) drag.moved = true;
    const elapsed = drag.lastTime == null ? 0 : Math.max(0, now - drag.lastTime);
    drag.lastTime = now;
    if (drag.moved && Math.abs(drag.supportNormal.y) > HORIZONTAL_NORMAL_Y && elapsed > 0) {
        const normalPart = drag.offset.dot(drag.supportNormal);
        const keep = Math.exp(-elapsed / RECENTER_TIME_MS);
        drag.offset.addScaledVector(drag.supportNormal, -normalPart).multiplyScalar(keep)
            .addScaledVector(drag.supportNormal, normalPart);
    }
    target.position.copy(_slide).add(drag.offset);

    // TAKEOVER candidate (needs to hold for its dwell time before snapping)
    let snapped = false;
    if (hit != null && !onSupport) {
        const side = drag.anchorPlane.distanceToPoint(ray.origin);
        const awayAmount = Math.abs(ray.direction.dot(drag.anchorPlane.normal));
        const pointingAway = side * ray.direction.dot(drag.anchorPlane.normal) > 0;
        const box = bodyBox(parent, body, target);
        const planeDistance = distanceToSurfacePlane(box, hit);
        const touching = box.distanceToPoint(hit.point) < CONTACT_DISTANCE;
        // Near: close to that surface (walls: any height; tops/ceiling: close to the hit point too)
        const isNear = planeDistance <= SNAP_DISTANCE && (hit.isWall || box.distanceToPoint(hit.point) <= SNAP_DISTANCE);
        const nearSnap = isNear && (pointedAt || touching);
        // Pull off a wall: from a vertical support, a pointed-at horizontal surface wins at any distance
        const pullOff = pointedAt && Math.abs(drag.supportNormal.y) <= HORIZONTAL_NORMAL_Y
            && Math.abs(hit.normal.y) > HORIZONTAL_NORMAL_Y;
        const farSnap = pointingAway && awayAmount > FAR_SNAP_ANGLE;
        if (nearSnap || farSnap || pullOff) {
            const key = `${hit.normal.x},${hit.normal.y},${hit.normal.z}:${hit.point.dot(hit.normal).toFixed(2)}`;
            if (drag.pending?.key !== key) drag.pending = { key, since: now };
            const dwell = nearSnap || pullOff ? SNAP_DWELL_MS : FAR_SNAP_DWELL_MS;
            if (now - drag.pending.since >= dwell) {
                const yaw = hit.isWall ? Math.atan2(hit.normal.x, hit.normal.z) : target.rotation.y;
                placeOn(target, body, hit.point, hit.normal, yaw);
                setSupport(drag, target, hit.normal, hit.point, hit.point, event);
                drag.pending = null;
                snapped = true;
            }
        } else {
            drag.pending = null;
        }
    } else {
        drag.pending = null;
    }

    // PULL THE ROPE: a quick pull of the hand back along the ray detaches from a wall and reels in
    if (drag.reel) {
        _pull.copy(drag.pullOrigin).sub(_worldRay.origin);
        const pull = _pull.dot(_direction.copy(_worldRay.direction).normalize());
        drag.pullOrigin.lerp(_worldRay.origin, 1 - Math.exp(-elapsed / PULL_WINDOW_MS));
        if (!snapped && pull > PULL_DISTANCE && Math.abs(drag.supportNormal.y) <= HORIZONTAL_NORMAL_Y) {
            ray.at(drag.grabDistance * REEL_FACTOR, _point);
            _worldRay.origin.copy(_point).applyMatrix4(parent.matrixWorld);
            _worldRay.direction.copy(_up).negate().transformDirection(parent.matrixWorld);
            const below = castSurface(parent, target, _worldRay);
            if (below != null) {
                placeOn(target, body, below.point, _up, target.rotation.y);
                localRay(event, parent); // restore the pointer ray (and _worldRay) for setSupport
                setSupport(drag, target, _up, below.point, _point, event);
                drag.pending = null;
                snapped = true;
            }
        }
    }

    if (!snapped) {
        // Orientation on horizontal supports: wrist twist (dead zone) around the ray -> yaw
        if (Math.abs(drag.supportNormal.y) > HORIZONTAL_NORMAL_Y) {
            let yaw = drag.yaw;
            if (drag.useTwist) {
                _delta.multiplyQuaternions(event.pointerQuaternion, drag.twistReference);
                yaw -= TWIST_TO_YAW * twistWithDeadzone(twistAngle(_delta, _direction.copy(_worldRay.direction).normalize()));
            }
            target.quaternion.setFromAxisAngle(_up, yaw);
        }

        // DROP off a raised horizontal support onto the surface below
        if (drag.supportNormal.y > HORIZONTAL_NORMAL_Y) {
            const below = surfaceBelow(target, body);
            if (below != null && below.point.y < below.box.min.y - SUPPORT_TOLERANCE) {
                const drop = below.box.min.y - below.point.y;
                target.position.y -= drop;
                drag.supportPlane.setFromNormalAndCoplanarPoint(_up, below.point);
                // Keep the anchor plane (the ray keeps hitting it at the same spot) and lower the
                // object relative to it: moving the plane would make the slide point jump far away
                drag.offset.y -= drop;
            }
        }
    }

    // GRID SNAP (only once the drag really started: a click or a still hold never moves the object)
    if (drag.gridStep > 0 && drag.moved) snapToGrid(target, drag.supportNormal, drag.gridStep);

    // ROOM BOUNDS: never leave the surfaces (open sides of the room, holes in the floor)
    keepOverSurface(target, body, _previousPosition);

    // SMOOTHING: blend from the previous pose; small/slow motions damped, large ones nearly 1:1
    if (!drag.smooth) return true;
    const speed = _previousPosition.distanceTo(target.position);
    const alpha = SMOOTHING_MIN_ALPHA + (1 - SMOOTHING_MIN_ALPHA) * Math.min(speed / SMOOTHING_FAST_SPEED, 1);
    target.position.lerpVectors(_previousPosition, target.position, alpha);
    target.quaternion.slerpQuaternions(_previousQuaternion, target.quaternion.clone(), alpha);
    return true;
}
