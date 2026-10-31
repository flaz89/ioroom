/*
* Which toolbar menu/panel is open: only one at a time, so opening one closes the previous.
* Names: 'sun' | 'materials' | 'bill' | 'rooms' | 'share' | 'render' | 'objects' | 'users' (null = none). Per device, never synced.
* perfOpen: performance stats (DOM PerfPanel, and the stats panel of the VR wrist menu), independent of
* the other panels (it stays while they open and close), EXCEPT on phones (same breakpoint as the css):
* there it and the other panels close each other, there is no room for both.
* wireframe: debug view, the whole scene drawn as wireframe (scene/perf/Wireframe.jsx).
* xrFoveation: VR foveation (0..1: higher = view edges drawn at lower resolution), per device, changed live from
* the wrist "Fov" button (applied in WristMenu.jsx). Default 1: on the Quest 2 it saves ~1.4 ms per frame vs 0.5
* (31/10), what it takes to get close to 72 Hz; the user can trade it back for sharper edges.
*/
const FOVEATIONS = [1, 0.75, 0.5];
const next = (list, value) => list[(list.indexOf(value) + 1) % list.length];
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

export const createPanelSlice = (set) => ({
    openPanel: null,
    perfOpen: false,
    wireframe: false,

    // Opens `name`, or closes it if it is already the open one
    togglePanel: (name) => set((state) => {
        const openPanel = state.openPanel === name ? null : name;
        return { openPanel, perfOpen: openPanel != null && isPhone() ? false : state.perfOpen };
    }),

    togglePerf: () => set((state) => {
        const perfOpen = !state.perfOpen;
        return { perfOpen, openPanel: perfOpen && isPhone() ? null : state.openPanel };
    }),

    toggleWireframe: () => set((state) => ({ wireframe: !state.wireframe })),

    xrFoveation: FOVEATIONS[0],
    cycleXrFoveation: () => set((state) => ({ xrFoveation: next(FOVEATIONS, state.xrFoveation) })),

    closePanel: () => set({ openPanel: null })
});
