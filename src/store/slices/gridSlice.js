export const createGridSlice = (set) => ({

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