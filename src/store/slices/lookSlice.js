/*
* Look of the environment: artistic choices of the project, not of a device. Saved in the environment and
* shared with everyone in the room (sync/roomSync.js, Y.Map "look", fieldMapSync.js; not in the undo history,
* like the sun). Only the owner edits them (RenderPanel.jsx), everyone sees them, VR included.
*   exposure    - tone mapping exposure (renderer.toneMappingExposure): overall brightness, 1 = neutral
*   environment - multiplier of the environment light (reflections + fill, components/light/Light.jsx)
*/
export const LOOK_DEFAULTS = { exposure: 1, environment: 1 };
// Slider ranges (RenderPanel.jsx), also used to validate values coming from the room
export const LOOK_RANGES = {
    exposure: { min: 0.25, max: 3, step: 0.05 },
    environment: { min: 0, max: 3, step: 0.05 }
};

// Only known keys with a finite number in range (a room written by an older / other client stays safe)
const sanitize = (values) => Object.fromEntries(Object.keys(LOOK_DEFAULTS).map((key) => {
    const value = values?.[key];
    const { min, max } = LOOK_RANGES[key];
    return [key, Number.isFinite(value) && value >= min && value <= max ? value : LOOK_DEFAULTS[key]];
}));

export const createLookSlice = (set) => ({
    look: { ...LOOK_DEFAULTS },

    // Merges a partial update, e.g. setLook({ exposure: 1.2 }); from the room sync it gets all its values
    setLook: (patch) => set((state) => ({ look: sanitize({ ...state.look, ...patch }) }))
});
