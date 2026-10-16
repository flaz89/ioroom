import { priceSnapshot } from '../../materials/billOfQuantities';

/*
* Materials of the room surfaces (floor, each wall).
*
* surfaces (saved in the environment, sync: Y.Map "surfaces", sync/roomSync.js + fieldMapSync.js):
*   face id (Room.jsx: 'floor', '<wall>:inner|outer|edge') -> material id (materials/library.js);
*   a missing surface uses the plain material. Everyone in the room can change them (like the objects).
* materialDrag (per device, never synced): { materialId, surfaceId, pointerId? } while a material is dragged
*   from the materials panel; surfaceId = surface under the pointer (previewed there), null over nothing.
*   pointerId: only VR drags (xr-ui/VRMaterialsPanel.jsx), the ray that Room.jsx follows.
* priceSnapshots (saved in the environment, sync: Y.Map "prices"): material id -> its product card
*   (price, VAT, waste, name...) FROZEN when the material is first applied in this project with a price
*   (materials/billOfQuantities.js): later price-list changes do not alter the project's estimate.
*/

export const createSurfacesSlice = (set, get) => ({
    surfaces: {},
    materialDrag: null,
    priceSnapshots: {},

    // Sets one surface's material, e.g. setSurfaceMaterial('wall-back:inner', 'brick_wall_001'),
    // freezing the material's price into the project the first time it is used with a price
    setSurfaceMaterial: (surfaceId, materialId) => set((state) => {
        const surfaces = { ...state.surfaces, [surfaceId]: materialId };
        if (state.priceSnapshots[materialId] != null) return { surfaces };
        const snapshot = priceSnapshot(get().libraryMaterials.find((material) => material.id === materialId));
        return snapshot ? { surfaces, priceSnapshots: { ...state.priceSnapshots, [materialId]: snapshot } } : { surfaces };
    }),

    // Merges frozen prices received from the shared room
    setPriceSnapshots: (patch) => set((state) => ({ priceSnapshots: { ...state.priceSnapshots, ...patch } })),

    // Merges materials received from the shared room
    setSurfaces: (patch) => set((state) => ({ surfaces: { ...state.surfaces, ...patch } })),

    // Drag state of the materials panel (null = no drag); skipped when nothing changed (called on every move)
    setMaterialDrag: (drag) => set((state) => {
        const current = state.materialDrag;
        if (current?.materialId === drag?.materialId && current?.surfaceId === drag?.surfaceId) return state;
        return { materialDrag: drag };
    })
});
