/*
* Performance statistics published by <PerfSampler> (inside the Canvas) and read by <PerfPanel> (DOM UI).
* "stats" is null while the panel is closed. Updated a few times per second, never per frame,
* so the DOM panel re-renders cheaply.
* hiddenStats: in XR, the last sample taken while the wrist menu was HIDDEN (the menu and the stats panel are
* themselves ~20 meshes drawn per eye, so samples read with the menu up overstate the scene's cost).
*/
export const createPerfSlice = (set) => ({

    perf: {
        stats: null,
        hiddenStats: null
    },

    setPerfStats: (stats, menuHidden = false) =>
        set((state) => ({ perf: { ...state.perf, stats, hiddenStats: stats == null ? null : menuHidden ? stats : state.perf.hiddenStats } }))
})
