import { DEFAULT_PLAN } from '../../plan/planModel';

/*
* The floor plan of the environment (plan/planModel.js): walls and floors the room is built from.
* Saved and shared with the room (Y.Map "plan", sync/roomSync.js); edited by the owner (plan editor:
* next step). A room created before plans gets the default plan (the 6 x 6 m test room).
*/
export const createPlanSlice = (set) => ({
    plan: DEFAULT_PLAN,

    // Merges plan fields received from the shared room (or set by the editor), e.g. { levels }
    setPlan: (patch) => set((state) => ({ plan: { ...state.plan, ...patch } }))
});
