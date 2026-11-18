import { floorAt, floorElevation, levelBounds, pointInPolygon, wallFootprint } from '../../../plan/planModel.js';

/*
* TELEPORT (VR, life mode, left hand pinch: TeleportGesture.jsx). Pure functions, world = plan meters
* (in life mode the board is the identity: plan [x, z] = world x, z; the ground is y = 0, raised floors at
* their elevation).
*
* teleportArc(origin, dir, groundAt) -> { points, landing, height }: the aiming arc, a throw from the hand
*   along `dir` (unit vector) at ARC_SPEED under gravity, sampled every ARC_STEP s; points: [[x, y, z]] up to
*   where it meets the ground (groundAt([x, z]) = its height there, default 0); landing: [x, z] there and
*   height = the ground's height, or landing null when it never comes down within ARC_TIME or MAX_DISTANCE.
* groundHeight(level, [x, z]): the elevation of the floor there (planModel floorAt), 0 off every floor.
* canLand(level, [x, z]): a valid place to stand: on a drawn floor and not inside a wall's footprint; a level
*   with no floors yet: anywhere inside its bounds (walls still excluded).
* XR ORIGIN (xr/xrOrigin.js): where the headset's base space sits in the world: { p: [x, z], yaw }, world =
*   rotateY(base, yaw) + p (y: the floor stood on, apart). rotateY([x, z], yaw): three's rotation about +Y.
* teleportOrigin(origin, head, target): the origin moved so that the head ([x, z], world) lands on target.
* startOrigin(start, headBase, headYawBase): the origin putting the head (base [x, z] and heading) on the
*   player start { p, yaw } (planModel level.playerStart), facing its yaw. Yaw 0 = looking towards -Z.
* Calibration knobs (tune on the headset): ARC_SPEED (reach), MAX_DISTANCE.
* ponytail: the arc does not stop on walls (it lands behind them, on the floor of the next room): a hit test
*   against the wall boxes if that turns out confusing.
*/
const ARC_SPEED = 7;       // m/s: throw speed (45° up reaches ~5 m from shoulder height)
const GRAVITY = 9.81;
const ARC_STEP = 1 / 60;   // s between samples
const ARC_TIME = 2.5;      // s: longest arc
export const MAX_DISTANCE = 12; // meters on the floor from the hand

export function teleportArc(origin, dir, groundAt = () => 0) {
    const points = [origin];
    const [vx, vy, vz] = dir.map((d) => d * ARC_SPEED);
    for (let t = ARC_STEP; t <= ARC_TIME + 1e-9; t += ARC_STEP) {
        const p = [origin[0] + vx * t, origin[1] + vy * t - (GRAVITY * t * t) / 2, origin[2] + vz * t];
        if (Math.hypot(p[0] - origin[0], p[2] - origin[2]) > MAX_DISTANCE) return { points, landing: null, height: 0 };
        const ground = groundAt([p[0], p[2]]);
        if (p[1] <= ground) {
            const q = points[points.length - 1];
            // where the last step crosses the ground (the step's end height: a 1/60 s step is a few cm)
            const k = q[1] > ground ? (q[1] - ground) / (q[1] - p[1]) : 1;
            const hit = [q[0] + (p[0] - q[0]) * k, ground, q[2] + (p[2] - q[2]) * k];
            points.push(hit);
            return { points, landing: [hit[0], hit[2]], height: ground };
        }
        points.push(p);
    }
    return { points, landing: null, height: 0 };
}

export const groundHeight = (level, point) => floorElevation(floorAt(level, point) ?? {});

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
* Enters between DROP_MIN and DROP_ENTER and within ~60° (back). While aiming only the height counts (leaves
* beyond DROP_EXIT): tilting the wrist down to aim close by turns the back away and used to cancel.
* Calibration knobs (tune on the headset): a hanging arm is ~0.75-0.9 m below the eyes standing, ~0.6-0.7 sitting.
*/
const cos = (degrees) => Math.cos((degrees * Math.PI) / 180);
export const TELEPORT_DROP_MIN = -0.15;  // hand at most this much above the eyes
export const TELEPORT_DROP_ENTER = 0.5;
export const TELEPORT_DROP_EXIT = 0.6;
export const TELEPORT_BACK_ENTER = cos(60);

export function isTeleportPose(drop, backToUser, wasPose) {
    return drop > TELEPORT_DROP_MIN && (wasPose
        ? drop < TELEPORT_DROP_EXIT
        : drop < TELEPORT_DROP_ENTER && backToUser > TELEPORT_BACK_ENTER);
}

export function rotateY([x, z], yaw) {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    return [x * cos + z * sin, -x * sin + z * cos];
}
export const teleportOrigin = (origin, head, target) => ({ ...origin, p: [origin.p[0] + target[0] - head[0], origin.p[1] + target[1] - head[1]] });
export function startOrigin(start, headBase, headYawBase) {
    const yaw = start.yaw - headYawBase;
    const [x, z] = rotateY(headBase, yaw);
    return { p: [start.p[0] - x, start.p[1] - z], yaw };
}
