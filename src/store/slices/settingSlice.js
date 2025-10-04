export const createSettings = (set, get) => ({

    settings: {
        perfVisibility: false
    },

    togglePerf: () => 
        set((state) => ({
            settings: {
                ...state.settings,
                perfVisibility: !state.settings.perfVisibility
            }
        }))
})