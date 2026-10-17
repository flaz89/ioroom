/*
* Workspace mode of the UI (per device, never synced):
* - 'designer': furnishing the environment — materials, furniture, notes, sun, bill of quantities.
* - 'builder':  building the environment — floor plan tools, 2D / perspective view (admin only).
* Guests are always in 'designer' (the switch is shown to the admin only, WorkspaceSwitch.jsx).
* Not to be confused with view.mode (viewSlice.js: 'life' / 'tabletop' presentation in XR).
*/

// Toolbar panels that belong to the designer tools: closed when entering the builder
const DESIGNER_PANELS = ['sun', 'materials', 'bill', 'objects'];

export const createWorkspaceSlice = (set, get) => ({
    workspace: 'designer',

    // Switches mode and drops the designer state that would stay active but invisible in the builder
    // (selected object with its gizmo, post-it placing mode, open designer panels)
    setWorkspace: (workspace) => {
        if (workspace === get().workspace) return;
        if (workspace === 'builder') {
            const state = get();
            state.deselectObject();
            if (state.notes.placing) state.setPlacingNote(false);
            if (DESIGNER_PANELS.includes(state.openPanel)) state.closePanel();
        }
        set({ workspace });
    }
});
