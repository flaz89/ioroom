/*
* Workspace mode of the UI (per device, never synced):
* - 'designer': furnishing the environment — materials, furniture, notes, sun, bill of quantities.
* - 'builder':  building the environment — floor plan tools, 2D / perspective view (admin only).
* Guests are always in 'designer' (the switch is shown to the admin only, WorkspaceSwitch.jsx).
* builderView: how the builder shows the environment — '2d' (top view plan, components/builder/PlanView2D.jsx)
*   or '3d' (the perspective 3D scene). Kept when leaving and re-entering the builder.
* selectedWallIds: walls selected in the builder (2D plan or 3D scene), shared by both views; their panel is
*   WallPanel.jsx (one wall: sizes; several: common thickness / height, delete). Cleared when leaving the
*   builder or changing tool. Single wall: singleSelectedWall(state).
* selectedOpening: { wallId, openingId } of the door / window selected in the builder (null = none); its panel
*   is WallPanel.jsx too. Exclusive with selectedWallIds: selecting one clears the other.
* selectedFloorId: floor selected with the floor tool (2D plan: vertex handles, Delete removes it), null = none.
*   Cleared when changing tool.
* planTool: active tool of the 2D plan view — 'select' (select walls, drag corners) | 'wall' (draw walls) | 'floor' (draw floors) | 'trace' (walls traced on a vector underlay) | 'opening' (doors / windows: plan/placeOpening.js).
* openingType: what the door / window tool places: 'door' | 'window' (picked on hover, LeftToolBar.jsx).
* wallJustify: where the wall tool puts the thickness, along the drawing direction: 'left' | 'center' | 'right'.
* planGrid: { minor, major } grid steps (meters) of the open 2D plan view, null when it is closed
*   (published by PlanView2D.jsx, shown by PlanGridLegend.jsx in the bottom bar).
* underlayVisible / underlayOpacity: how this device shows the floor plan underlay (planModel.js level.underlay):
*   a view preference, per device, never synced nor undoable. Hidden = the floor is back in the 3D view.
* planWallOpacity: fill opacity of the walls in the 2D plan (per device, from the underlay panel): lowered to
*   see the drawing through the walls while tracing (their outline stays).
* underlayTool: active underlay adjustment of the 2D plan (two clicks each, PlanView2D.jsx): null |
*   'calibrate' (a known length) | 'align' (a line onto an axis) | 'move' (a point onto a plan point).
* wallDetection: automatic walls found on a DXF underlay layer (plan/dxfWalls.js), previewed in the 2D plan:
*   null | { url, layer, walls, excluded } (url: the underlay they belong to; excluded: indices of the walls the
*   user left out, toggleDetectedWall). Per device, never synced nor undoable.
* partsMenu: the DESIGNER's parts menu of a door / window (components/ui/parts-menu/PartsMenu.jsx), opened by a
*   right click on it (Openings3D.jsx): { openingId, x, y } (x, y = the click in screen px), null = closed.
*   Per device, never synced; closed when switching mode.
* Not to be confused with view.mode (viewSlice.js: 'life' / 'tabletop' presentation in XR).
*/

// Toolbar panels that belong to the designer tools: closed when entering the builder
const DESIGNER_PANELS = ['sun', 'materials', 'bill', 'objects'];

export const createWorkspaceSlice = (set, get) => ({
    workspace: 'designer',
    builderView: '2d',

    setBuilderView: (builderView) => set({ builderView }),

    selectedWallIds: [],
    // one wall (or none with null)
    setSelectedWallId: (wallId) => set({ selectedWallIds: wallId ? [wallId] : [], selectedOpening: null }),
    setSelectedWallIds: (selectedWallIds) => set({ selectedWallIds, selectedOpening: null }),
    // Shift+click: adds the wall, or removes it if already selected
    toggleSelectedWall: (wallId) => set((state) => ({
        selectedOpening: null,
        selectedWallIds: state.selectedWallIds.includes(wallId)
            ? state.selectedWallIds.filter((id) => id !== wallId)
            : [...state.selectedWallIds, wallId]
    })),

    selectedOpening: null,
    setSelectedOpening: (selectedOpening) => set({ selectedOpening, selectedWallIds: [] }),

    planTool: 'select',
    setPlanTool: (planTool) => set({ planTool, selectedWallIds: [], selectedOpening: null, selectedFloorId: null, underlayTool: null }),

    partsMenu: null,
    setPartsMenu: (partsMenu) => set({ partsMenu }),

    selectedFloorId: null,
    setSelectedFloorId: (selectedFloorId) => set({ selectedFloorId }),

    openingType: 'door',
    setOpeningType: (openingType) => set({ openingType }),

    // levelPreview: the active level as it would be after a gesture in progress in the 3D builder (an opening
    // resized with its 3D handles: Openings3D.jsx). This device only, never synced: Room.jsx draws it instead
    // of the plan's level while set; the gesture commits it with setActiveLevel on release (one undo step).
    levelPreview: null,
    setLevelPreview: (levelPreview) => set({ levelPreview }),

    wallJustify: 'left',
    setWallJustify: (wallJustify) => set({ wallJustify }),

    underlayVisible: true,
    underlayOpacity: 0.5,
    setUnderlayVisible: (underlayVisible) => set({ underlayVisible }),
    setUnderlayOpacity: (underlayOpacity) => set({ underlayOpacity }),
    planWallOpacity: 1,
    setPlanWallOpacity: (planWallOpacity) => set({ planWallOpacity }),
    underlayTool: null,
    // an underlay tool works in the 2D plan: it switches the view there, and owns the clicks (no wall tool)
    setUnderlayTool: (underlayTool) => set(underlayTool
        ? { underlayTool, builderView: '2d', planTool: 'select', selectedWallIds: [], selectedOpening: null }
        : { underlayTool: null }),

    wallDetection: null,
    setWallDetection: (wallDetection) => set({ wallDetection: wallDetection && { excluded: [], ...wallDetection } }),
    // A detected wall left out of "Add walls" (or taken back)
    toggleDetectedWall: (index) => set((state) => {
        const detection = state.wallDetection;
        if (detection == null) return {};
        const excluded = detection.excluded.includes(index) ? detection.excluded.filter((i) => i !== index) : [...detection.excluded, index];
        return { wallDetection: { ...detection, excluded } };
    }),

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
        if (workspace === 'designer' && get().openPanel === 'underlay') get().closePanel(); // builder-only panel
        set({ workspace, selectedWallIds: [], selectedOpening: null, underlayTool: null, partsMenu: null });
    }
});

// The selected wall when exactly one is selected, else null (single-wall tools: sizes, flip)
export const singleSelectedWall = (state) => (state.selectedWallIds.length === 1 ? state.selectedWallIds[0] : null);
