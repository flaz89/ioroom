/*
* Which toolbar menu/panel is open: only one at a time, so opening one closes the previous.
* Names: 'sun' | 'materials' | 'bill' | 'rooms' | 'share' | 'objects' | 'users' (null = none). Per device, never synced.
* perfOpen: performance stats (DOM PerfPanel, and the stats panel of the VR wrist menu), independent of
* the other panels (it stays while they open and close), EXCEPT on phones (same breakpoint as the css):
* there it and the other panels close each other, there is no room for both.
*/
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

export const createPanelSlice = (set) => ({
    openPanel: null,
    perfOpen: false,

    // Opens `name`, or closes it if it is already the open one
    togglePanel: (name) => set((state) => {
        const openPanel = state.openPanel === name ? null : name;
        return { openPanel, perfOpen: openPanel != null && isPhone() ? false : state.perfOpen };
    }),

    togglePerf: () => set((state) => {
        const perfOpen = !state.perfOpen;
        return { perfOpen, openPanel: perfOpen && isPhone() ? null : state.openPanel };
    }),

    closePanel: () => set({ openPanel: null })
});
