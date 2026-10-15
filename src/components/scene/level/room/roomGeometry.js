import { PlaneGeometry } from 'three';

/*
* Geometry of the room surfaces, with WORLD-SPACE UVs ("box mapping" baked on the CPU).
*
* Every face gets UVs equal to its vertex positions in meters along the face's own axes (room space),
* so a material repeats every `tileSize` meters on any surface (texture repeat = 1 / tileSize, the same
* for all), patterns stay continuous along each axis (brick courses line up all around the room) and
* nothing is ever stretched. Same look as triplanar mapping on flat surfaces, at zero shader cost and
* on both renderers. Rooms built from plans (extruded walls) will reuse planarUVs.
*
* UV rule (u = right, v = up, seen from outside the face, never mirrored):
*   +X: u = -z, v = y    -X: u = z,  v = y
*   +Z: u = x,  v = y    -Z: u = -x, v = y
*   +Y: u = x,  v = -z   -Y: u = x,  v = z
*/
const AXES = { px: [0, 1], nx: [0, -1], py: [1, 1], ny: [1, -1], pz: [2, 1], nz: [2, -1] };

// Writes world-space UVs on an already positioned geometry whose faces all point along `face` (AXES key)
export function planarUVs(geometry, face) {
    const [axis, sign] = AXES[face];
    const position = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        if (axis === 0) uv.setXY(i, -sign * z, y);
        else if (axis === 2) uv.setXY(i, sign * x, y);
        else uv.setXY(i, x, -sign * z);
    }
    uv.needsUpdate = true;
    return geometry;
}

/*
* The 6 faces of an axis-aligned box (room space): { px, nx, py, ny, pz, nz } -> PlaneGeometry already
* placed in room space (the meshes stay at the origin), facing outwards, with world-space UVs.
* center: [x, y, z], size: [sx, sy, sz] in meters.
*/
export function boxFaces(center, size) {
    const [cx, cy, cz] = center;
    const [sx, sy, sz] = size;
    const face = (name, width, height, orient, offset) => {
        const geometry = new PlaneGeometry(width, height); // faces +Z, spans X (width) and Y (height)
        orient(geometry);
        geometry.translate(cx + offset[0], cy + offset[1], cz + offset[2]);
        return planarUVs(geometry, name);
    };
    return {
        px: face('px', sz, sy, (g) => g.rotateY(Math.PI / 2), [sx / 2, 0, 0]),
        nx: face('nx', sz, sy, (g) => g.rotateY(-Math.PI / 2), [-sx / 2, 0, 0]),
        py: face('py', sx, sz, (g) => g.rotateX(-Math.PI / 2), [0, sy / 2, 0]),
        ny: face('ny', sx, sz, (g) => g.rotateX(Math.PI / 2), [0, -sy / 2, 0]),
        pz: face('pz', sx, sy, () => {}, [0, 0, sz / 2]),
        nz: face('nz', sx, sy, (g) => g.rotateY(Math.PI), [0, 0, -sz / 2])
    };
}

// Floor of size [x, z] at y = 0, facing up
export function floorGeometry(x, z) {
    const geometry = new PlaneGeometry(x, z).rotateX(-Math.PI / 2);
    return planarUVs(geometry, 'py');
}
