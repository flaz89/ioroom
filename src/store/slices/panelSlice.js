/*
* Which toolbar menu/panel is open: only one at a time, so opening one closes the previous.
* Names: 'sun' | 'rooms' | 'share' | 'objects' | 'users' (null = none). Per device, never synced.
* The performance stats overlay is not a menu and stays independent (settings.perfVisibility).
*/
export const createPanelSlice = (set) => ({
    openPanel: null,

    // Opens `name`, or closes it if it is already the open one
    togglePanel: (name) => set((state) => ({ openPanel: state.openPanel === name ? null : name })),

    closePanel: () => set({ openPanel: null })
});
