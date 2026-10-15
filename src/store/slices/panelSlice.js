/*
* Which toolbar menu/panel is open: only one at a time, so opening one closes the previous.
* Names: 'sun' | 'materials' | 'rooms' | 'share' | 'objects' | 'users' | 'perf' (null = none). Per device, never synced.
* 'perf' = performance stats (DOM PerfPanel, and the stats panel of the VR wrist menu).
*/
export const createPanelSlice = (set) => ({
    openPanel: null,

    // Opens `name`, or closes it if it is already the open one
    togglePanel: (name) => set((state) => ({ openPanel: state.openPanel === name ? null : name })),

    closePanel: () => set({ openPanel: null })
});
