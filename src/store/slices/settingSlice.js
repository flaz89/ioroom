export const createSettingsSlice = (set) => ({

    settings: {
        perfVisibility: false,
        gridSnap: false // moved objects snap to GRID_SNAP_STEP cells and 15° yaw steps (see surfaceDrag.js)
    },

    toggleGridSnap: () =>
        set((state) => ({
            settings: { ...state.settings, gridSnap: !state.settings.gridSnap }
        })),

    togglePerf: () => 
        set((state) => ({
            settings: {
                ...state.settings,
                perfVisibility: !state.settings.perfVisibility
            }
        }))
})