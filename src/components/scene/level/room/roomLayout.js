import { Box3, Vector3 } from 'three';
import { boxFaces, floorGeometry } from './roomGeometry.js';

/*
* The faces of the (fixed, test) room as data: what Room.jsx draws and what the bill of quantities
* measures (materials/billOfQuantities.js), so both always agree.
* ponytail: walls are fixed boxes around a [x, z] room; rooms from plans will describe walls as data
* (and subtract doors / windows from the wall areas).
*/
export const ROOM_SIZES = [6, 6];     // meters [x, z]
export const WALL_HEIGHT = 2.7;
export const WALL_THICKNESS = 0.15;
const FLOOR_COLOR = '#d4d4d4';         // plain material colors
const WALL_COLOR = '#ffffff';
const VERTICAL_FACES = ['px', 'nx', 'pz', 'nz'];
const WALLS = { 'wall-left': 'Left wall', 'wall-right': 'Right wall', 'wall-back': 'Back wall' };

/*
* Every visible face: { key, geometry, surfaceId, vertical, color }. Face ids (surfaceId): 'floor',
* '<wall>:inner' (the side the room sees), '<wall>:outer', '<wall>:edge' (top and ends). The bottom of a
* wall sits on the floor, never seen: not built.
*/
export function roomFaces([x, z]) {
    const h = WALL_HEIGHT, t = WALL_THICKNESS;
    const wall = (id, center, size, inner, outer) => Object.entries(boxFaces(center, size))
        .filter(([face, geometry]) => face !== 'ny' || (geometry.dispose(), false))
        .map(([face, geometry]) => ({
            key: `${id}-${face}`,
            geometry,
            surfaceId: `${id}:${face === inner ? 'inner' : face === outer ? 'outer' : 'edge'}`,
            vertical: VERTICAL_FACES.includes(face),
            color: WALL_COLOR
        }));
    return [
        { key: 'floor', geometry: floorGeometry(x, z), surfaceId: 'floor', vertical: false, color: FLOOR_COLOR },
        ...wall('wall-left', [-(x + t) / 2, h / 2, 0], [t, h, z], 'px', 'nx'),
        ...wall('wall-right', [(x + t) / 2, h / 2, 0], [t, h, z], 'nx', 'px'),
        ...wall('wall-back', [0, h / 2, -(z + t) / 2], [x + 2 * t, h, t], 'pz', 'nz')
    ];
}

/*
* Area of every face id of the room: { surfaceId: m² } (faces sharing an id, e.g. edges, are summed).
* All faces are axis-aligned rectangles: area = the two largest sides of their bounding box.
* INSIDE faces are clipped to the room interior first: the walls overlap at the corners (the back wall
* runs behind the side walls), and the hidden strip must not be billed. Rounded to cm².
*/
export function surfaceAreas([x, z]) {
    const interior = new Box3(new Vector3(-x / 2, 0, -z / 2), new Vector3(x / 2, WALL_HEIGHT, z / 2));
    const areas = {};
    for (const face of roomFaces([x, z])) {
        face.geometry.computeBoundingBox();
        const box = face.geometry.boundingBox;
        if (face.surfaceId.endsWith(':inner')) box.intersect(interior);
        const [, second, first] = box.getSize(new Vector3()).toArray().sort((a, b) => a - b);
        areas[face.surfaceId] = (areas[face.surfaceId] ?? 0) + first * second;
        face.geometry.dispose();
    }
    for (const id of Object.keys(areas)) areas[id] = Math.round(areas[id] * 100) / 100;
    return areas;
}

// Human name of a face id, e.g. 'wall-left:inner' -> 'Left wall · inside'
export function surfaceLabel(surfaceId) {
    if (surfaceId === 'floor') return 'Floor';
    const [wall, side] = surfaceId.split(':');
    const sides = { inner: 'inside', outer: 'outside', edge: 'top & ends' };
    return `${WALLS[wall] ?? wall} · ${sides[side] ?? side}`;
}
