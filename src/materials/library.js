/*
* Material library: the materials people can drag onto the room surfaces (and, later, onto objects).
*
* A material RECORD has the shape the database/API will return:
*   { id, name, category: 'floor' | 'wall', tileSize, maps: { color, normal, roughness } }
* - tileSize: real side of one texture tile in meters, so patterns keep their real scale on any surface;
* - maps: texture URLs (PBR: sRGB color, OpenGL normal, roughness). Today local files in
*   public/textures/<id>/ (Poly Haven CC0, 1K WebP, download: scripts/fetch-textures.sh);
*   later the URLs of the stored files.
* The scene and the sync only ever store material IDs (store `surfaces`), never the records.
* PLAIN is built in (no textures): each surface keeps its own default color.
*
* ponytail: static local list. When materials move to the DB, load the records once (API) into a store
* slice and make listMaterials / findMaterial read it: callers do not change.
*/
export const PLAIN_ID = 'plain';

const PLAIN = { id: PLAIN_ID, name: 'Plain', category: null, tileSize: 1, maps: null };

// Local test files: public/textures/<id>/<id>_<map>_1k.webp
const localMaps = (id) => ({
    color: `/textures/${id}/${id}_diff_1k.webp`,
    normal: `/textures/${id}/${id}_nor_gl_1k.webp`,
    roughness: `/textures/${id}/${id}_rough_1k.webp`
});

const LIBRARY = [
    { id: 'diagonal_parquet', name: 'Diagonal parquet', category: 'floor', tileSize: 2.36 },
    { id: 'dark_wooden_planks', name: 'Dark planks', category: 'floor', tileSize: 2 },
    { id: 'concrete_floor_painted', name: 'Painted concrete', category: 'floor', tileSize: 2 },
    { id: 'beige_wall_001', name: 'Beige plaster', category: 'wall', tileSize: 3 },
    { id: 'clay_plaster', name: 'Clay plaster', category: 'wall', tileSize: 2 },
    // Poly Haven says 3 m, but its bricks read too big next to real ones: calibrated by eye
    { id: 'brick_wall_001', name: 'Brick', category: 'wall', tileSize: 1.5 }
].map((material) => ({ ...material, maps: localMaps(material.id) }));

// Every material, PLAIN first
export const listMaterials = () => [PLAIN, ...LIBRARY];

// Unknown ids (a material removed from the library) fall back to PLAIN
export const findMaterial = (id) => LIBRARY.find((material) => material.id === id) ?? PLAIN;
