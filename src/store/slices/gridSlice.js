export const createGridSlice = (set, get) => ({

    grid: {
        visible: true
    },

    toggleGrid: () =>
        set((state) => ({
        grid: {                    
            ...state.grid,
            visible: !state.grid.visible
        }
        }))
})