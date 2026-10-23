// Snap steps offered by the snap pickers (desktop toolbar and VR wrist menu)
export const GRID_SNAP_STEPS = [1, 5, 20, 50, 100];   // centimeters
export const ROTATION_SNAP_STEPS = [1, 5, 15, 45, 90]; // degrees

/*
* RENDER SETTINGS (desktop WebGPU effects): per DEVICE, kept in localStorage (a powerful Mac and a tablet
* want different settings), never synced with the room.
* - ssgi: screen-space GI + AO (components/scene/PostEffects.jsx, with TRAA)
* - ssr: screen-space reflections (PostEffects.jsx)
* - denoise: spatial denoise of the SSGI (PostEffects.jsx); off by default: before TRAA it turns the fine
*   grain into crawling blotches, it needs a temporal reprojection first
* - lightProbes: baked diffuse GI from a light probe grid (components/light/LightProbes.jsx); off by
*   default, kept for VR later
* - ssgiQuality: SSGI sample preset (SSGI_QUALITIES)
* - giIntensity: strength of the SSGI indirect light (three.js default 10, ours 4)
* - aoIntensity: darkness of the SSGI ambient occlusion (three.js default 1, range [0, 4])
* - ssrIntensity: strength of the reflections (1 = physical)
*/
const RENDER_KEY = 'ioroom.render';

// SSGI presets (with temporal filtering): samples per pixel = slices * steps * 2. More slices = less
// flicker in the shadowed areas (three.js advice), so they grow first. Medium = what looked best on the
// test scene (23/10).
export const SSGI_QUALITIES = {
    low: { label: 'Low', slices: 2, steps: 6 },
    medium: { label: 'Medium', slices: 3, steps: 8 },
    high: { label: 'High', slices: 3, steps: 16 }
};
// Slider ranges of the numeric render settings (RenderPanel.jsx), also used to validate saved values
export const RENDER_RANGES = {
    giIntensity: { min: 0, max: 30, step: 0.5 },
    aoIntensity: { min: 0, max: 4, step: 0.1 },
    ssrIntensity: { min: 0, max: 2, step: 0.05 }
};
export const RENDER_DEFAULTS = {
    ssgi: true, ssr: true, denoise: false, lightProbes: false,
    // giIntensity 4: Flavio's pick on the test scene (23/10); aoIntensity 2: visibly darker corners and contacts
    ssgiQuality: 'medium', giIntensity: 4, aoIntensity: 2, ssrIntensity: 1
};

// A saved value is kept only if it has the default's type and is in range / a known preset, so a stale or
// edited localStorage entry can never inject anything else
function isValidRenderValue(key, value) {
    const fallback = RENDER_DEFAULTS[key];
    if (typeof value !== typeof fallback) return false;
    if (key === 'ssgiQuality') return Object.hasOwn(SSGI_QUALITIES, value);
    if (typeof value === 'number') return Number.isFinite(value) && value >= RENDER_RANGES[key].min && value <= RENDER_RANGES[key].max;
    return true;
}

function loadRenderSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(RENDER_KEY));
        return Object.fromEntries(Object.keys(RENDER_DEFAULTS).map((key) => [key, isValidRenderValue(key, saved?.[key]) ? saved[key] : RENDER_DEFAULTS[key]]));
    } catch {
        return { ...RENDER_DEFAULTS };
    }
}

function saveRenderSettings(settings) {
    const values = Object.fromEntries(Object.keys(RENDER_DEFAULTS).map((key) => [key, settings[key]]));
    try { localStorage.setItem(RENDER_KEY, JSON.stringify(values)); } catch { /* this visit only */ }
}

export const createSettingsSlice = (set) => ({

    settings: {
        gridSnap: false,  // moved objects snap to grid cells and 15° yaw steps (see surfaceDrag.js)
        gridSnapStep: 5,  // grid cell size in CENTIMETERS (real cm, also inside the tabletop model)
        rotationSnap: false,  // rotations snap to rotationSnapStep (yaw for drags, every gizmo axis)
        rotationSnapStep: 15, // rotation step in DEGREES
        ...loadRenderSettings()
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

    // Render settings: flips one (RENDER_DEFAULTS key) and saves them on this device
    toggleRenderSetting: (key) =>
        set((state) => {
            const settings = { ...state.settings, [key]: !state.settings[key] };
            saveRenderSettings(settings);
            return { settings };
        }),

    // Render settings: sets one (quality preset, intensities) and saves them on this device; invalid values
    // are ignored
    setRenderSetting: (key, value) =>
        set((state) => {
            if (!isValidRenderValue(key, value)) return {};
            const settings = { ...state.settings, [key]: value };
            saveRenderSettings(settings);
            return { settings };
        }),

    toggleGridSnap: () =>
        set((state) => ({
            settings: { ...state.settings, gridSnap: !state.settings.gridSnap }
        }))
})