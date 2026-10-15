/*
* The material library (records stored in R2 by the server, server/src/materials.js), loaded once at
* startup (App.jsx) and updated after uploads/edits/deletions by the owner. Read through materials/library.js.
* libraryFilter: tab (category) and chip (kind, null = all) shown by the materials panels, shared by
* the desktop and the VR panel (materials/grouping.js). Per device, never synced.
*/
export const createMaterialLibrarySlice = (set) => ({
    libraryMaterials: [],

    libraryFilter: { category: 'floor', kind: null },

    setLibraryMaterials: (libraryMaterials) => set({ libraryMaterials }),

    // Another tab resets the chip (its kinds differ)
    setLibraryFilter: (patch) => set((state) => {
        const next = { ...state.libraryFilter, ...patch };
        if (patch.category != null && patch.category !== state.libraryFilter.category && patch.kind === undefined) next.kind = null;
        return { libraryFilter: next };
    })
});
