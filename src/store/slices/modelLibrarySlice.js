import { SYNC_HOST } from '../../sync/roomSync';
import { listModels } from '../../models/modelsApi';

/*
* The furniture catalog (records stored in R2 by the server, server/src/models.js), loaded at startup
* (App.jsx) and again from the "+" menu's "Retry" after a failure. Read through models/catalog.js;
* organized by models/grouping.js.
* libraryModelsStatus: 'loading' | 'ready' | 'error' (the menu shows placeholders, the list, or Retry).
*/
export const createModelLibrarySlice = (set) => ({
    libraryModels: [],
    libraryModelsStatus: 'loading',

    setLibraryModels: (libraryModels) => set({ libraryModels }),

    // Without the sync server there is no catalog (only the basic shapes)
    loadLibraryModels: async () => {
        if (!SYNC_HOST) return set({ libraryModels: [], libraryModelsStatus: 'ready' });
        set({ libraryModelsStatus: 'loading' });
        try {
            set({ libraryModels: await listModels(), libraryModelsStatus: 'ready' });
        } catch (error) {
            console.warn('Furniture catalog not loaded:', error.message);
            set({ libraryModelsStatus: 'error' });
        }
    }
});
