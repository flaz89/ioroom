import { DEFAULT_PLAN, activeLevel, flipWall, withActiveLevel } from '../../plan/planModel';

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
    setActiveLevel: (level) => get().setPlan({ levels: withActiveLevel(get().plan, level).levels }),

    // Thickness to the other side of the wall's line (planModel.flipWall). The inner and outer faces swap
    // roles, so their materials (surfaces slice) swap too: each face keeps its look. Plan and surfaces are
    // written in the same tick -> one undo step (history.js capture timeout).
    flipWallSide: (wallId) => {
        const { plan, surfaces } = get();
        get().setActiveLevel(flipWall(activeLevel(plan), wallId));
        const inner = `${wallId}:inner`, outer = `${wallId}:outer`;
        const swapped = { ...surfaces };
        delete swapped[inner];
        delete swapped[outer];
        if (surfaces[outer] != null) swapped[inner] = surfaces[outer];
        if (surfaces[inner] != null) swapped[outer] = surfaces[inner];
        set({ surfaces: swapped });
    }
});
