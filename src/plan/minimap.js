import { faceOffsets, wallFootprint, wallFrame } from './planModel.js';

/*
* MINIMAP of a level (tour: ui/minimap/Minimap.jsx on screen, xr-ui/VRMinimap.jsx on the VR palm). Pure.
* minimapShapes(level) -> { floors, walls, openings, bounds }: polygons in plan meters [[x, z]], drawn in that
* order (openings over the walls = the gaps of doors and windows), bounds { min, max } of everything.
* fitMinimap(bounds, size, pad) -> { scale, toMap([x, z]) -> [u, v] }: plan meters to a size × size map
* (pixels, v down = +Z: plan "up" is -Z, like the 2D plan), centered, `pad` kept on every side.
* headingOf([qx, qy, qz, qw]): the yaw a rotation looks along (its -Z on the floor; 0 = towards -Z, three's
*   rotation about +Y): the other players' heads (presence avatars) on the map.
*/
export const headingOf = ([qx, qy, qz, qw]) => Math.atan2(2 * (qx * qz + qw * qy), 1 - 2 * (qx * qx + qy * qy));

export function minimapShapes(level) {
    const floors = level.floors.map((floor) => floor.points);
    const walls = level.walls.map((wall) => {
        const f = wallFootprint(wall, level.walls);
        return [f.a, f.b, f.bOut, f.aOut];
    });
    const openings = level.walls.flatMap((wall) => {
        const { dir, normal } = wallFrame(wall);
        const { inner, outer } = faceOffsets(wall);
        const at = (t, offset) => [wall.a[0] + dir[0] * t + normal[0] * offset, wall.a[1] + dir[1] * t + normal[1] * offset];
        return (wall.openings ?? []).map(({ offset, width }) => {
            const [t0, t1] = [offset - width / 2, offset + width / 2];
            return [at(t0, inner), at(t1, inner), at(t1, outer), at(t0, outer)];
        });
    });
    const points = [...floors.flat(), ...walls.flat()];
    const min = points.length ? [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))] : [-1, -1];
    const max = points.length ? [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))] : [1, 1];
    return { floors, walls, openings, bounds: { min, max } };
}

export function fitMinimap({ min, max }, size, pad) {
    const span = Math.max(max[0] - min[0], max[1] - min[1], 1e-6);
    const scale = (size - pad * 2) / span;
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    return { scale, toMap: ([x, z]) => [size / 2 + (x - center[0]) * scale, size / 2 + (z - center[1]) * scale] };
}
