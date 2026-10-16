import { useTexture } from '@react-three/drei';
import { useStore } from '../store/appStore';

/*
* Material library: the materials people can drag onto the room surfaces (and, later, onto objects).
*
* A material RECORD: { id, name, category: 'floor' | 'wall' | null, tileSize, maps }
* - tileSize: real side of one texture tile in meters, so patterns keep their real scale on any surface;
* - maps: texture URLs { color, normal?, orm? } (PBR: sRGB color, OpenGL normal, ORM = packed
*   R ambient occlusion / G roughness / B metalness, like glTF); older records may carry `roughness`
*   instead of `orm`. null for PLAIN (each surface keeps its own default color).
* Every material except PLAIN lives in the database: Cloudflare R2 (server/src/materials.js), loaded at
* startup into the store (`libraryMaterials`, App.jsx); the owner adds and deletes them from the
* materials panel. The scene and the sync only ever store material IDs (store `surfaces`): a room opened
* before the list arrives shows plain surfaces for a moment, then the textures; a deleted material
* turns plain.
*/
export const PLAIN_ID = 'plain';

const PLAIN = { id: PLAIN_ID, name: 'Plain', category: null, tileSize: 1, maps: null };

// Material for `id`; unknown ids (deleted, not loaded yet) -> PLAIN
const findIn = (list, id) => list.find((material) => material.id === id) ?? PLAIN;

// React: the material record for `id` (re-renders when the library changes)
export const useMaterial = (id) => useStore((state) => findIn(state.libraryMaterials, id));

// React: PLAIN first, then the library
export function useMaterialList() {
    const library = useStore((state) => state.libraryMaterials);
    return [PLAIN, ...library];
}

// material.maps keys; orm = packed R ambient occlusion / G roughness / B metalness (glTF layout, which is
// how three.js reads aoMap / roughnessMap / metalnessMap); `roughness` only on records made before ORM
export const TEXTURE_MAPS = ['color', 'normal', 'orm', 'roughness'];

/*
* Starts loading a material's textures (drei cache, the one SurfaceMesh.jsx reads) before they are
* needed: called when a drag starts in the materials panels, so they are decoded while the ball travels
* to the wall instead of when the preview first shows on a face (a hitch in VR).
*/
export function preloadMaterialTextures(material) {
    if (material?.maps == null) return;
    useTexture.preload(TEXTURE_MAPS.filter((name) => material.maps[name]).map((name) => material.maps[name]));
}
