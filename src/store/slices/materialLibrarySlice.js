/*
* The material library (records stored in R2 by the server, server/src/materials.js), loaded once at
* startup (App.jsx) and updated after uploads/deletions by the owner. Read through materials/library.js.
*/
export const createMaterialLibrarySlice = (set) => ({
    libraryMaterials: [],

    setLibraryMaterials: (libraryMaterials) => set({ libraryMaterials })
});
