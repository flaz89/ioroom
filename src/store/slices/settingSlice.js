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
// QUALITY PRESETS: each sets the effect switches and the GI quality together (intensities are artistic
// choices and stay untouched). Ordered from the cheapest. 'auto' starts at the best one and steps down by
// itself (lowerAutoQuality, called by the adaptive resolution in Scene.jsx); 'custom' = switches or GI
// quality changed by hand.
export const QUALITY_PRESETS = {
    low: { label: 'Low', values: { ssgi: false, ssr: false, ssgiQuality: 'low', denoise: false, lightProbes: false } },
    medium: { label: 'Medium', values: { ssgi: true, ssr: false, ssgiQuality: 'low', denoise: false, lightProbes: false } },
    high: { label: 'High', values: { ssgi: true, ssr: true, ssgiQuality: 'medium', denoise: false, lightProbes: false } }
};
const PRESET_ORDER = Object.keys(QUALITY_PRESETS); // cheapest first
const AUTO_START = 'high';
export const RENDER_PRESET_CHOICES = ['auto', ...PRESET_ORDER, 'custom'];
// settings a preset decides: changing one by hand turns the preset into 'custom'
const PRESET_FIELDS = Object.keys(QUALITY_PRESETS.high.values);

export const RENDER_DEFAULTS = {
    renderPreset: 'auto',
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
    if (key === 'renderPreset') return RENDER_PRESET_CHOICES.includes(value);
    if (typeof value === 'number') return Number.isFinite(value) && value >= RENDER_RANGES[key].min && value <= RENDER_RANGES[key].max;
    return true;
}

function loadRenderSettings() {
    let values;
    try {
        const saved = JSON.parse(localStorage.getItem(RENDER_KEY));
        values = Object.fromEntries(Object.keys(RENDER_DEFAULTS).map((key) => [key, isValidRenderValue(key, saved?.[key]) ? saved[key] : RENDER_DEFAULTS[key]]));
    } catch {
        values = { ...RENDER_DEFAULTS };
    }
    // a named preset is re-applied (its definition may have changed); Auto starts every visit from the top
    const preset = values.renderPreset === 'auto' ? AUTO_START : values.renderPreset;
    return QUALITY_PRESETS[preset] ? { ...values, ...QUALITY_PRESETS[preset].values } : values;
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

    // Render settings: flips one (RENDER_DEFAULTS key) and saves them on this device. A switch a preset
    // decides turns the preset into 'custom'.
    toggleRenderSetting: (key) =>
        set((state) => {
            const settings = { ...state.settings, [key]: !state.settings[key] };
            if (PRESET_FIELDS.includes(key)) settings.renderPreset = 'custom';
            saveRenderSettings(settings);
            return { settings };
        }),

    // Render settings: sets one (GI quality, intensities) and saves them on this device; invalid values are
    // ignored. The GI quality is decided by the presets: changing it by hand turns the preset into 'custom'.
    setRenderSetting: (key, value) =>
        set((state) => {
            if (key === 'renderPreset' || !isValidRenderValue(key, value)) return {};
            const settings = { ...state.settings, [key]: value };
            if (PRESET_FIELDS.includes(key)) settings.renderPreset = 'custom';
            saveRenderSettings(settings);
            return { settings };
        }),

    // Quality preset (RENDER_PRESET_CHOICES): applies its switches; 'auto' starts from AUTO_START; 'custom'
    // keeps the current switches
    setRenderPreset: (preset) =>
        set((state) => {
            if (!RENDER_PRESET_CHOICES.includes(preset)) return {};
            const level = preset === 'auto' ? AUTO_START : preset;
            const settings = { ...state.settings, ...QUALITY_PRESETS[level]?.values, renderPreset: preset };
            saveRenderSettings(settings);
            return { settings };
        }),

    // Auto quality: one preset down (frame rate still below the minimum at the lowest resolution, Scene.jsx).
    // Only while the preset is 'auto'; it never goes back up during the visit (no oscillation), the next visit
    // starts again from the top.
    lowerAutoQuality: () =>
        set((state) => {
            if (state.settings.renderPreset !== 'auto') return {};
            // current level: the best preset whose switches match the current settings
            const current = [...PRESET_ORDER].reverse().find((name) =>
                Object.entries(QUALITY_PRESETS[name].values).every(([key, value]) => state.settings[key] === value)) ?? AUTO_START;
            const lower = PRESET_ORDER[PRESET_ORDER.indexOf(current) - 1];
            if (lower === undefined) return {};
            const settings = { ...state.settings, ...QUALITY_PRESETS[lower].values };
            saveRenderSettings(settings);
            return { settings };
        }),

    toggleGridSnap: () =>
        set((state) => ({
            settings: { ...state.settings, gridSnap: !state.settings.gridSnap }
        }))
})