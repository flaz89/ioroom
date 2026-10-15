/*
* Materials of the room surfaces (floor, each wall), saved in the environment (sync: Y.Map "surfaces",
* sync/roomSync.js + fieldMapSync.js). `surfaces` maps a surface id (ROOM_SURFACES in
* components/scene/level/room/surfaceMaterials.js) to a material id (SURFACE_MATERIALS);
* a missing surface uses the plain material. Everyone in the room can change them (like the objects).
*/
export const createSurfacesSlice = (set) => ({
    surfaces: {},

    // Sets one surface's material, e.g. setSurfaceMaterial('wall-back', 'brick_wall_001')
    setSurfaceMaterial: (surfaceId, materialId) => set((state) => ({
        surfaces: { ...state.surfaces, [surfaceId]: materialId }
    })),

    // Merges materials received from the shared room
    setSurfaces: (patch) => set((state) => ({ surfaces: { ...state.surfaces, ...patch } }))
});
