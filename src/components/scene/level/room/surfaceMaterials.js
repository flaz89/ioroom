/*
* Room surface materials (store `surfaces`, store/slices/surfacesSlice.js).
*
* SURFACE_MATERIALS: the library. Textured entries are Poly Haven CC0 PBR sets (1K, WebP) in
* public/textures/<id>/ (download: scripts/fetch-textures.sh): color, OpenGL normal and roughness maps.
* `size` = real side of one texture tile in meters (Poly Haven "dimensions"), so the pattern keeps its
* real scale on any surface. `kinds` = surfaces it is offered for ('floor' | 'wall').
* 'plain' = the untextured default (each surface keeps its own plain color).
*
* ROOM_SURFACES: the surfaces of the current fixed room (Room.jsx). Rooms built from plans will list
* their own surfaces (one per wall) here.
*/
export const PLAIN = 'plain';

export const SURFACE_MATERIALS = [
    { id: PLAIN, name: 'Plain', kinds: ['floor', 'wall'] },
    { id: 'diagonal_parquet', name: 'Diagonal parquet', kinds: ['floor'], size: 2.36 },
    { id: 'dark_wooden_planks', name: 'Dark planks', kinds: ['floor'], size: 2 },
    { id: 'concrete_floor_painted', name: 'Painted concrete', kinds: ['floor'], size: 2 },
    { id: 'beige_wall_001', name: 'Beige plaster', kinds: ['wall'], size: 3 },
    { id: 'clay_plaster', name: 'Clay plaster', kinds: ['wall'], size: 2 },
    { id: 'brick_wall_001', name: 'Brick', kinds: ['wall'], size: 3 }
];

export const ROOM_SURFACES = [
    { id: 'floor', name: 'Floor', kind: 'floor' },
    { id: 'wall-back', name: 'Back wall', kind: 'wall' },
    { id: 'wall-left', name: 'Left wall', kind: 'wall' },
    { id: 'wall-right', name: 'Right wall', kind: 'wall' }
];

// Unknown ids (e.g. a material removed from the library) fall back to plain
export const findSurfaceMaterial = (id) => SURFACE_MATERIALS.find((material) => material.id === id) ?? SURFACE_MATERIALS[0];

// map: 'diff' (color) | 'nor_gl' (normal) | 'rough' (roughness)
export const textureUrl = (id, map) => `/textures/${id}/${id}_${map}_1k.webp`;
