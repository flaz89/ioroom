/*
* Materials of the room surfaces (floor, each wall).
*
* surfaces (saved in the environment, sync: Y.Map "surfaces", sync/roomSync.js + fieldMapSync.js):
*   face id (Room.jsx: 'floor', '<wall>:inner|outer|edge') -> material id (materials/library.js);
*   a missing surface uses the plain material. Everyone in the room can change them (like the objects).
* materialDrag (per device, never synced): { materialId, surfaceId, pointerId? } while a material is dragged
*   from the materials panel; surfaceId = surface under the pointer (previewed there), null over nothing.
*   pointerId: only VR drags (xr-ui/VRMaterialsPanel.jsx), the ray that Room.jsx follows.
*/
export const createSurfacesSlice = (set) => ({
    surfaces: {},
    materialDrag: null,

    // Sets one surface's material, e.g. setSurfaceMaterial('wall-back:inner', 'brick_wall_001')
    setSurfaceMaterial: (surfaceId, materialId) => set((state) => ({
        surfaces: { ...state.surfaces, [surfaceId]: materialId }
    })),

    // Merges materials received from the shared room
    setSurfaces: (patch) => set((state) => ({ surfaces: { ...state.surfaces, ...patch } })),

    // Drag state of the materials panel (null = no drag); skipped when nothing changed (called on every move)
    setMaterialDrag: (drag) => set((state) => {
        const current = state.materialDrag;
        if (current?.materialId === drag?.materialId && current?.surfaceId === drag?.surfaceId) return state;
        return { materialDrag: drag };
    })
});
