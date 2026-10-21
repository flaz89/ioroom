import { priceSnapshot } from '../../materials/billOfQuantities';
import { activeLevel } from '../../plan/planModel';
import { PLAIN_ID } from '../../materials/library';

/*
* Materials of the room surfaces (floor, each wall).
*
* surfaces (saved in the environment, sync: Y.Map "surfaces", sync/roomSync.js + fieldMapSync.js):
*   face id (Room.jsx: 'floor', '<wall>:inner|outer|edge') -> material id (materials/library.js); also doors
*   and windows: '<opening>' (whole structure) and '<opening>:frame|leaf|handle' (doorModel.partMaterialId);
*   a missing surface uses the plain material. Everyone in the room can change them (like the objects).
* materialDrag (per device, never synced): { materialId, surfaceId, pointerId? } while a material is dragged
*   from the materials panel; surfaceId = surface under the pointer (previewed there), null over nothing.
*   pointerId: only VR drags (xr-ui/VRMaterialsPanel.jsx), the ray that Room.jsx follows.
* priceSnapshots (saved in the environment, sync: Y.Map "prices"): material id -> its product card
*   (price, VAT, waste, name...) FROZEN when the material is first applied in this project with a price
*   (materials/billOfQuantities.js): later price-list changes do not alter the project's estimate.
*/

// The new `surfaces`, plus the material's price frozen into the project the first time it is used with one
function withPrice(state, surfaces, materialId) {
    if (state.priceSnapshots[materialId] != null) return { surfaces };
    const snapshot = priceSnapshot(state.libraryMaterials.find((material) => material.id === materialId));
    return snapshot ? { surfaces, priceSnapshots: { ...state.priceSnapshots, [materialId]: snapshot } } : { surfaces };
}

export const createSurfacesSlice = (set) => ({
    surfaces: {},
    materialDrag: null,
    priceSnapshots: {},

    // Sets one surface's material, e.g. setSurfaceMaterial('wall-back:inner', 'brick_wall_001'),
    // freezing the material's price into the project the first time it is used with a price
    setSurfaceMaterial: (surfaceId, materialId) => set((state) => withPrice(state, { ...state.surfaces, [surfaceId]: materialId }, materialId)),

    /*
    * A material DROPPED on `targetId` (materials panels, desktop and VR): a room face (setSurfaceMaterial), or a
    * door / window (its id: Openings3D parts, doorModel.partMaterialId) = the material of its whole STRUCTURE,
    * dropping its own frame / leaf materials (they would hide it; the handle keeps its own). allOfType (Shift,
    * flatscreen): every opening of the same type (doors / windows) of the level gets it.
    */
    dropMaterial: (targetId, materialId, { allOfType = false } = {}) => set((state) => {
        const walls = activeLevel(state.plan).walls;
        const target = walls.flatMap((wall) => wall.openings ?? []).find((opening) => opening.id === targetId);
        if (target == null) return withPrice(state, { ...state.surfaces, [targetId]: materialId }, materialId);
        const ids = allOfType ? walls.flatMap((wall) => (wall.openings ?? []).filter((o) => o.type === target.type).map((o) => o.id)) : [targetId];
        const surfaces = { ...state.surfaces };
        for (const id of ids) {
            if (materialId === PLAIN_ID) delete surfaces[id]; // Plain = back to the default finishes
            else surfaces[id] = materialId;
            delete surfaces[`${id}:frame`];
            delete surfaces[`${id}:leaf`];
        }
        return withPrice(state, surfaces, materialId);
    }),

    // Replaces the frozen prices with the room's (sync/roomSync.js: all values, removed keys included)
    setPriceSnapshots: (priceSnapshots) => set({ priceSnapshots }),

    // Replaces the surface materials with the room's (sync/roomSync.js): a surface reset by another device
    // or by undo (history.js) is missing from the room and must disappear here too, so no merge
    setSurfaces: (surfaces) => set({ surfaces }),

    // Drag state of the materials panel (null = no drag); skipped when nothing changed (called on every move)
    setMaterialDrag: (drag) => set((state) => {
        const current = state.materialDrag;
        if (current?.materialId === drag?.materialId && current?.surfaceId === drag?.surfaceId) return state;
        return { materialDrag: drag };
    })
});
