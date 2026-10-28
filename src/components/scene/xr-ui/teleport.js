import { floorAt, levelBounds, pointInPolygon, wallFootprint } from '../../../plan/planModel.js';

/*
* TELEPORT (VR, life mode, left hand pinch: TeleportGesture.jsx). Pure functions, world = plan meters
* (in life mode the board is the identity: plan [x, z] = world x, z; the floor is y = 0).
*
* teleportArc(origin, dir) -> { points, landing }: the aiming arc, a throw from the hand along `dir` (unit
*   vector) at ARC_SPEED under gravity, sampled every ARC_STEP s; points: [[x, y, z]] up to where it meets
*   the floor; landing: [x, z] there, or null when it never comes down within ARC_TIME or MAX_DISTANCE.
* canLand(level, [x, z]): a valid place to stand: on a drawn floor and not inside a wall's footprint; a level
*   with no floors yet: anywhere inside its bounds (walls still excluded).
* teleportOffset(offset, head, target) -> new offset [x, z] of the XR reference space (XRRigidTransform position
*   relative to the session's base space) that puts the head's ground point on `target`: poses in the offset
*   space are base poses minus the offset, so new = old + head - target (head: current world [x, z]).
* Calibration knobs (tune on the headset): ARC_SPEED (reach), MAX_DISTANCE.
* ponytail: the arc does not stop on walls (it lands behind them, on the floor of the next room): a hit test
*   against the wall boxes if that turns out confusing.
*/
const ARC_SPEED = 7;       // m/s: throw speed (45° up reaches ~5 m from shoulder height)
const GRAVITY = 9.81;
const ARC_STEP = 1 / 60;   // s between samples
const ARC_TIME = 2.5;      // s: longest arc
export const MAX_DISTANCE = 12; // meters on the floor from the hand

export function teleportArc(origin, dir) {
    const points = [origin];
    const [vx, vy, vz] = dir.map((d) => d * ARC_SPEED);
    for (let t = ARC_STEP; t <= ARC_TIME + 1e-9; t += ARC_STEP) {
        const p = [origin[0] + vx * t, origin[1] + vy * t - (GRAVITY * t * t) / 2, origin[2] + vz * t];
        if (Math.hypot(p[0] - origin[0], p[2] - origin[2]) > MAX_DISTANCE) return { points, landing: null };
        if (p[1] <= 0) {
            const q = points[points.length - 1];
            const k = q[1] / (q[1] - p[1]); // where the last step crosses y = 0
            const hit = [q[0] + (p[0] - q[0]) * k, 0, q[2] + (p[2] - q[2]) * k];
            points.push(hit);
            return { points, landing: [hit[0], hit[2]] };
        }
        points.push(p);
    }
    return { points, landing: null };
}

export function canLand(level, point) {
    if (level.walls.some((wall) => {
        const f = wallFootprint(wall, level.walls);
        return pointInPolygon(point, [f.a, f.b, f.bOut, f.aOut]);
    })) return false;
    if (level.floors.length > 0) return floorAt(level, point) != null;
    const { min, max } = levelBounds(level);
    return point[0] >= min[0] && point[0] <= max[0] && point[1] >= min[1] && point[1] <= max[1];
}

/*
* TELEPORT POSE (like the delete pose, fistGesture.js): the pinch only counts with the hand RAISED in front
* (not hanging along the body, where the cameras still see it) and the BACK of the hand towards the user.
* drop: meters from the eyes down to the wrist; backToUser: see handPose.js measureHandPose.
* Hysteresis: enters between DROP_MIN and DROP_ENTER and within ~60° (back), leaves beyond DROP_EXIT / ~75°.
* Calibration knobs (tune on the headset): a hanging arm is ~0.75-0.9 m below the eyes standing, ~0.6-0.7 sitting.
*/
const cos = (degrees) => Math.cos((degrees * Math.PI) / 180);
export const TELEPORT_DROP_MIN = -0.15;  // hand at most this much above the eyes
export const TELEPORT_DROP_ENTER = 0.5;
export const TELEPORT_DROP_EXIT = 0.6;
export const TELEPORT_BACK_ENTER = cos(60);
export const TELEPORT_BACK_EXIT = cos(75);

export function isTeleportPose(drop, backToUser, wasPose) {
    return drop > TELEPORT_DROP_MIN && (wasPose
        ? drop < TELEPORT_DROP_EXIT && backToUser > TELEPORT_BACK_EXIT
        : drop < TELEPORT_DROP_ENTER && backToUser > TELEPORT_BACK_ENTER);
}

export const teleportOffset =(offset, head, target) => [offset[0] + head[0] - target[0], offset[1] + head[1] - target[1]];
