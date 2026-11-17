import { ceilingHeight, facetNormal, levelBounds, openingOperation, pointInPolygon, roofFacets, wallFootprint } from '../../../plan/planModel.js';
import { canLand, groundHeight } from '../xr-ui/teleport.js';

/*
* FIRST-PERSON WALK (Tour, flatscreen: WalkControls.jsx). Pure functions, plan meters [x, z].
* canWalk(level, [x, z], openDoors): a place to stand like the teleport's canLand (on a drawn floor, out of the
*   walls), plus the doorways: inside a wall's footprint only within a floor-level opening (sill 0) that is a
*   passage / hole or an OPEN door / window (openDoors, planSlice.js); a closed door stops you.
* walkStep(level, from, move, openDoors) -> new [x, z]: `from` + `move`, sliding along what stops it (x alone,
*   then z alone) instead of sticking to it. The body has a radius: the point BODY_RADIUS ahead must be free too.
*   Standing where one cannot (start inside a wall, a closed door shut on you): every move is let through, to
*   walk out (it used to freeze there).
* standingPoint(level, near, openDoors): `near` if one can stand there, else the closest such point (rings of
*   SEARCH_STEP around it), else `near` (nothing walkable at all).
* boomLength(level, head, back, max, openDoors): third person, how far the camera can sit from the head along
*   `back` ([x, y, z] unit, from the head [x, y, z]) before a wall, the end of the floors or the ceiling / roof
*   (BOOM_CLEARANCE under it; ceilings false = they are hidden, only the walls count), at most `max`, at least BOOM_MIN.
* eyeHeight(level, [x, z]): EYE_HEIGHT above the floor there (raised floors), lowered under a low roof (kept
*   HEAD_CLEARANCE under it: you stoop under the slope).
* ceilingAt(level, [x, z]): height of the lowest ceiling / roof over the point (flat ceilings, pitched roofs: the
*   same planes as planModel roofHeightAt, prepared once per level), Infinity without one. Dormers and roof holes
*   are ignored (they only give MORE room: the camera stays a bit lower there). canWalk also needs MIN_HEADROOM.
*/
export const EYE_HEIGHT = 1.6;   // m above the floor
export const BODY_RADIUS = 0.25; // m: how close to a wall the eyes can get
const DOOR_MARGIN = 0.15;        // m kept from the jambs
export const MIN_HEADROOM = 1.2; // m: lower than this under a roof slope is not walkable
const HEAD_CLEARANCE = 0.15;     // m kept between the eyes and the ceiling
const MIN_EYES = 0.9;            // m: the lowest you stoop

const ALWAYS_OPEN = new Set(['passage', 'hole']);

// [x, z] inside a doorway of this wall (along the wall line, within the opening's width)?
function inDoorway(wall, point, openDoors) {
    const dx = wall.b[0] - wall.a[0], dz = wall.b[1] - wall.a[1];
    const length = Math.hypot(dx, dz);
    if (length === 0) return false;
    const along = ((point[0] - wall.a[0]) * dx + (point[1] - wall.a[1]) * dz) / length;
    return (wall.openings ?? []).some((opening) => (opening.sill ?? 0) === 0
        && Math.abs(along - opening.offset) <= opening.width / 2 - DOOR_MARGIN
        && (ALWAYS_OPEN.has(openingOperation(opening)) || openDoors[opening.id] === true));
}

export function canWalk(level, point, openDoors = {}) {
    let doorway = false;
    for (const wall of level.walls) {
        const f = wallFootprint(wall, level.walls);
        if (!pointInPolygon(point, [f.a, f.b, f.bOut, f.aOut])) continue;
        if (!inDoorway(wall, point, openDoors)) return false;
        doorway = true;
    }
    // the doorway's floor strip is not a floor of the data: standing in the opening is enough
    if (!doorway && !canLand(level, point)) return false;
    return ceilingAt(level, point) - groundHeight(level, point) >= MIN_HEADROOM;
}

const free = (level, from, to, openDoors) => {
    const dx = to[0] - from[0], dz = to[1] - from[1];
    const length = Math.hypot(dx, dz);
    if (length === 0) return true;
    const ahead = [to[0] + (dx / length) * BODY_RADIUS, to[1] + (dz / length) * BODY_RADIUS];
    return canWalk(level, to, openDoors) && canWalk(level, ahead, openDoors);
};

export function walkStep(level, from, move, openDoors = {}) {
    if (!canWalk(level, from, openDoors)) return [from[0] + move[0], from[1] + move[1]];
    const candidates = [
        [from[0] + move[0], from[1] + move[1]],
        [from[0] + move[0], from[1]],
        [from[0], from[1] + move[1]]
    ];
    return candidates.find((to) => free(level, from, to, openDoors)) ?? from;
}

export function eyeHeight(level, point) {
    const ground = groundHeight(level, point);
    return Math.max(ground + MIN_EYES, Math.min(ground + EYE_HEIGHT, ceilingAt(level, point) - HEAD_CLEARANCE));
}

const ceilingCache = new WeakMap(); // level -> [{ points, heightAt }] (a new plan = a new level object)
function ceilingsOf(level) {
    let list = ceilingCache.get(level);
    if (list == null) {
        list = (level.ceilings ?? []).map((ceiling) => {
            const facets = roofFacets(ceiling, level);
            if (facets == null) {
                const height = ceilingHeight(ceiling, level);
                return { points: ceiling.points, heightAt: () => height };
            }
            const planes = facets.map(({ points }) => [points[0], facetNormal(points)]);
            return {
                points: ceiling.points,
                heightAt: (p) => Math.min(...planes.map(([[x0, y0, z0], n]) => y0 - (n[0] * (p[0] - x0) + n[2] * (p[1] - z0)) / n[1]))
            };
        });
        ceilingCache.set(level, list);
    }
    return list;
}

export function ceilingAt(level, point) {
    let height = Infinity;
    for (const { points, heightAt } of ceilingsOf(level)) {
        if (pointInPolygon(point, points)) height = Math.min(height, heightAt(point));
    }
    return height;
}

// Joystick of touch screens (ui/walk-joystick/WalkJoystick.jsx) -> WalkControls.jsx: x = right,
// y = forward, both -1..1 (0 = released). Shared module state: one joystick, one walker.
export const walkInput = { x: 0, y: 0 };

const SEARCH_STEP = 0.3; // m between the rings of standingPoint

export function standingPoint(level, near, openDoors = {}) {
    if (canWalk(level, near, openDoors)) return near;
    const { center, radius } = levelBounds(level);
    const reach = Math.hypot(near[0] - center[0], near[1] - center[1]) + radius;
    for (let r = SEARCH_STEP; r <= reach; r += SEARCH_STEP) {
        const count = Math.ceil((2 * Math.PI * r) / SEARCH_STEP);
        for (let i = 0; i < count; i++) {
            const angle = (2 * Math.PI * i) / count;
            const point = [near[0] + r * Math.cos(angle), near[1] + r * Math.sin(angle)];
            if (canWalk(level, point, openDoors)) return point;
        }
    }
    return near;
}

export const BOOM_MIN = 0.1;  // m: the camera never gets closer to the head; less than BODY_RADIUS, so with the
                              // back against a wall it is still in the room (the avatar hides, WalkControls.jsx)
const BOOM_STEP = 0.1;
const BOOM_REFINE = 6;     // halvings of the last step: ~2 mm
const BOOM_CLEARANCE = 0.2;   // m kept from the wall behind and from the ceiling above

export function boomLength(level, head, back, max, openDoors = {}, ceilings = true) {
    const at = (length) => [head[0] + back[0] * length, head[2] + back[2] * length];
    // the wall is tested BOOM_CLEARANCE further, the ceiling BOOM_CLEARANCE lower
    const blocked = (length) => !canWalk(level, at(length + BOOM_CLEARANCE), openDoors)
        || (ceilings && head[1] + back[1] * length > ceilingAt(level, at(length)) - BOOM_CLEARANCE);
    for (let length = BOOM_STEP; length <= max + 1e-9; length += BOOM_STEP) {
        if (!blocked(length)) continue;
        // refined between the last free step and this one: a CONTINUOUS length (10 cm steps made the camera
        // jump while walking towards a wall behind)
        let [free, hit] = [length - BOOM_STEP, length];
        for (let i = 0; i < BOOM_REFINE; i++) {
            const mid = (free + hit) / 2;
            if (blocked(mid)) hit = mid; else free = mid;
        }
        return Math.max(BOOM_MIN, free);
    }
    return max;
}
