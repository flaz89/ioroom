/*
* Performance statistics published by <PerfSampler> (inside the Canvas) and read by <PerfPanel> (DOM UI).
* "stats" is null while the panel is closed. Updated a few times per second, never per frame,
* so the DOM panel re-renders cheaply.
*/
export const createPerfSlice = (set) => ({

    perf: {
        stats: null
    },

    setPerfStats: (stats) =>
        set((state) => ({ perf: { ...state.perf, stats } }))
})
