import { DEFAULT_PLAN, activeLevel, flipWall, newWallId, removeFloor, removeWall, splitWall, wallFaceIds, withActiveLevel } from '../../plan/planModel';

/*
* The floor plan of the environment (plan/planModel.js): walls and floors the room is built from.
* Saved and shared with the room (Y.Map "plan", sync/roomSync.js); edited by the owner (plan editor:
* next step). A room created before plans gets the default plan (the 6 x 6 m test room).
*/
export const createPlanSlice = (set, get) => ({
    plan: DEFAULT_PLAN,

    // Merges plan fields received from the shared room (or set by the editor), e.g. { levels }
    setPlan: (patch) => set((state) => ({ plan: { ...state.plan, ...patch } })),

    // Replaces the level being worked on (plan editor: one call per committed edit = one undo step).
    // FLOORS are independent of the walls: they are drawn by the user (floor tool) and never rebuilt or
    // moved by wall edits (old auto floors, from the closed-perimeter era, are kept as they are).
    setActiveLevel: (level) => get().setPlan({ levels: withActiveLevel(get().plan, level).levels }),

    // Thickness to the other side of the wall's line (planModel.flipWall). The inner and outer faces swap
    // roles, so their materials (surfaces slice) swap too: each face keeps its look. Plan and surfaces are
    // written in the same tick -> one undo step (history.js capture timeout).
    // Deletes walls and their face materials (no orphan materials left in the bill of quantities): one undo step
    deleteWalls: (wallIds) => {
        const { plan, surfaces } = get();
        get().setActiveLevel(wallIds.reduce((level, wallId) => removeWall(level, wallId), activeLevel(plan)));
        const remaining = { ...surfaces };
        wallIds.forEach((wallId) => wallFaceIds(wallId).forEach((faceId) => delete remaining[faceId]));
        set({ surfaces: remaining, selectedWallIds: [] });
    },

    // Deletes a floor and its material (no orphan material in the bill of quantities): one undo step
    deleteFloor: (floorId) => {
        get().setActiveLevel(removeFloor(activeLevel(get().plan), floorId));
        const { [floorId]: _removed, ...remaining } = get().surfaces;
        set({ surfaces: remaining, selectedFloorId: null });
    },

    // The same field patch on several walls at once (group edit: thickness / height), one undo step
    updateWalls: (wallIds, patch) => {
        const level = activeLevel(get().plan);
        get().setActiveLevel({ ...level, walls: level.walls.map((wall) => (wallIds.includes(wall.id) ? { ...wall, ...patch } : wall)) });
    },

    // Splits a wall at its middle (planModel.splitWall): the second piece copies the first one's face
    // materials, so the wall looks the same. Returns false if the wall is too short to split.
    splitWallInHalf: (wallId) => {
        const { plan, surfaces } = get();
        const newId = newWallId();
        const next = splitWall(activeLevel(plan), wallId, newId);
        if (next == null) return false;
        get().setActiveLevel(next);
        const copied = { ...surfaces };
        wallFaceIds(wallId).forEach((faceId, index) => {
            if (surfaces[faceId] != null) copied[wallFaceIds(newId)[index]] = surfaces[faceId];
        });
        set({ surfaces: copied });
        return true;
    },

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
