/*
* How the environment is presented in XR:
* - 'life':     1:1 scale, the user stands inside the room.
* - 'tabletop': the room becomes a miniature model on a virtual table (board-game / "The Sims" view).
* Reset to 'life' when an XR session ends (see src/xr/xrStore.js).
*/
export const createViewSlice = (set) => ({

    view: {
        mode: 'life',
        handMenuVisible: false // wrist menu currently shown (palm/wrist facing the eyes)
    },

    setHandMenuVisible: (visible) =>
        set((state) => ({ view: { ...state.view, handMenuVisible: visible } })),

    toggleTabletop: () =>
        set((state) => ({
            view: { ...state.view, mode: state.view.mode === 'tabletop' ? 'life' : 'tabletop' }
        })),

    setViewMode: (mode) =>
        set((state) => ({ view: { ...state.view, mode } }))
})
