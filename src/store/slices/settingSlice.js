// Snap steps offered by the snap pickers (desktop toolbar and VR wrist menu)
export const GRID_SNAP_STEPS = [1, 5, 20, 50, 100];   // centimeters
export const ROTATION_SNAP_STEPS = [1, 5, 15, 45, 90]; // degrees

export const createSettingsSlice = (set) => ({

    settings: {
        perfVisibility: false,
        gridSnap: false,  // moved objects snap to grid cells and 15° yaw steps (see surfaceDrag.js)
        gridSnapStep: 5,  // grid cell size in CENTIMETERS (real cm, also inside the tabletop model)
        rotationSnap: false,  // rotations snap to rotationSnapStep (yaw for drags, every gizmo axis)
        rotationSnapStep: 15  // rotation step in DEGREES
    },

    toggleRotationSnap: () =>
        set((state) => ({
            settings: { ...state.settings, rotationSnap: !state.settings.rotationSnap }
        })),

    // Picking a step also turns the rotation snap on
    setRotationSnapStep: (degrees) =>
        set((state) => ({
            settings: { ...state.settings, rotationSnapStep: degrees, rotationSnap: true }
        })),

    // Picking a cell size also turns the snap on
    setGridSnapStep: (centimeters) =>
        set((state) => ({
            settings: { ...state.settings, gridSnapStep: centimeters, gridSnap: true }
        })),

    toggleGridSnap: () =>
        set((state) => ({
            settings: { ...state.settings, gridSnap: !state.settings.gridSnap }
        })),

    togglePerf: () => 
        set((state) => ({
            settings: {
                ...state.settings,
                perfVisibility: !state.settings.perfVisibility
            }
        }))
})