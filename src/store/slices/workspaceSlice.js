/*
* Workspace mode of the UI (per device, never synced):
* - 'designer': furnishing the environment — materials, furniture, notes, sun, bill of quantities.
* - 'builder':  building the environment — floor plan tools, 2D / perspective view (admin only).
* Guests are always in 'designer' (the switch is shown to the admin only, WorkspaceSwitch.jsx).
* builderView: how the builder shows the environment — '2d' (top view plan, components/builder/PlanView2D.jsx)
*   or '3d' (the perspective 3D scene). Kept when leaving and re-entering the builder.
* planGrid: { minor, major } grid steps (meters) of the open 2D plan view, null when it is closed
*   (published by PlanView2D.jsx, shown by PlanGridLegend.jsx in the bottom bar).
* Not to be confused with view.mode (viewSlice.js: 'life' / 'tabletop' presentation in XR).
*/

// Toolbar panels that belong to the designer tools: closed when entering the builder
const DESIGNER_PANELS = ['sun', 'materials', 'bill', 'objects'];

export const createWorkspaceSlice = (set, get) => ({
    workspace: 'designer',
    builderView: '2d',

    setBuilderView: (builderView) => set({ builderView }),

    planGrid: null,
    setPlanGrid: (planGrid) => set({ planGrid }),

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
