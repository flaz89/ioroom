import { SYNC_HOST } from '../../sync/roomSync';
import { listModels } from '../../models/modelsApi';
import { SHAPE_LIFT } from './objectsSlice';

/*
* The furniture catalog (records stored in R2 by the server, server/src/models.js), loaded at startup
* (App.jsx) and again from the "+" menu's "Retry" after a failure. Read through models/catalog.js;
* organized by models/grouping.js.
* libraryModelsStatus: 'loading' | 'ready' | 'error' (the menu shows placeholders, the list, or Retry).
* modelDrag (per device, never synced): a piece dragged out of the catalog, { model, variantId | type (a basic
* shape, VR panel), point,
* pointerId? (VR ray), x?, y? (desktop cursor) }; point = where it would land ([x, y, z] board meters,
* models/spawnPoint.js dropPoint) or null. The hologram follows it (level/ModelDragGhost.jsx); dropModel adds
* the piece there (selected) and closes the catalog, or does nothing without a point.
*/
export const createModelLibrarySlice = (set, get) => ({
    libraryModels: [],
    libraryModelsStatus: 'loading',
    modelDrag: null,

    setModelDrag: (modelDrag) => set({ modelDrag }),
    dropModel: () => {
        const drag = get().modelDrag;
        set({ modelDrag: null });
        if (drag?.point == null) return;
        const [x, y, z] = drag.point;
        if (drag.type != null) get().addObject(drag.type, [x, y + SHAPE_LIFT, z]);
        else get().addModel(drag.model, drag.variantId, drag.point);
        get().closePanel();
    },

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
