import { DEFAULT_PLAN, withActiveLevel } from '../../plan/planModel';

/*
* The floor plan of the environment (plan/planModel.js): walls and floors the room is built from.
* Saved and shared with the room (Y.Map "plan", sync/roomSync.js); edited by the owner (plan editor:
* next step). A room created before plans gets the default plan (the 6 x 6 m test room).
*/
export const createPlanSlice = (set, get) => ({
    plan: DEFAULT_PLAN,

    // Merges plan fields received from the shared room (or set by the editor), e.g. { levels }
    setPlan: (patch) => set((state) => ({ plan: { ...state.plan, ...patch } })),

    // Replaces the level being worked on (plan editor: one call per committed edit = one undo step)
    setActiveLevel: (level) => get().setPlan({ levels: withActiveLevel(get().plan, level).levels })
});
