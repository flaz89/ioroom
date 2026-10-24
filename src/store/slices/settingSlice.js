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
// Where AUTO got to on this device ({ level, dpr }): the next visit starts there instead of from the top, so
// Auto does not land somewhere different every time (a few seconds of measuring vary with heat, other apps,
// shader compiles)
const AUTO_KEY = 'ioroom.render.auto';

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
// itself (stepAuto, called by scene/perf/AdaptiveQuality.jsx); 'custom' = switches or GI
// quality changed by hand.
// Calibrated on Flavio's MacBook Pro M2 Max at 2x, his case-study room (24/10): GI Medium vs Low quality is
// hardly visible after TRAA but costs a lot; the reflections (half resolution) are cheap and show on glossy
// floors (marble, parquet); the GI itself is the big cost. Medium holds 30 fps at 2x on battery, about twice
// that on the charger. GI quality 'high' (3 x 16) is left to Custom: no preset is worth its cost.
export const QUALITY_PRESETS = {
    low: { label: 'Low', values: { ssgi: false, ssr: false, ssgiQuality: 'low', denoise: false, lightProbes: false } },
    medium: { label: 'Medium', values: { ssgi: true, ssr: false, ssgiQuality: 'low', denoise: false, lightProbes: false } },
    high: { label: 'High', values: { ssgi: true, ssr: true, ssgiQuality: 'low', denoise: false, lightProbes: false } },
    ultra: { label: 'Ultra', values: { ssgi: true, ssr: true, ssgiQuality: 'medium', denoise: false, lightProbes: false } }
};
const PRESET_ORDER = Object.keys(QUALITY_PRESETS); // cheapest first
const AUTO_START = 'ultra';
export const RENDER_PRESET_CHOICES = ['auto', ...PRESET_ORDER, 'custom'];

// RESOLUTION (canvas pixel ratio): 'auto' follows the frame rate (stepAuto), or forced by the user.
// Never above the screen's own ratio, and at most 2 (screen-space effects cost per pixel).
export const MAX_DPR = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
export const RESOLUTION_CHOICES = ['auto', '1', '1.5', '2'];
const AUTO_DPR_STEPS = [MAX_DPR, 1.5, 1].filter((dpr, index, all) => dpr <= MAX_DPR && all.indexOf(dpr) === index);
// The pixel ratio the canvas uses for these settings and the current auto ratio
export const effectiveDpr = (settings, autoDpr) =>
    settings.renderResolution === 'auto' ? autoDpr : Math.min(Number(settings.renderResolution), MAX_DPR);
// The quality level whose switches match the settings (the best one), null if none does (Custom)
export const currentQualityLevel = (settings) => [...PRESET_ORDER].reverse().find((name) =>
    Object.entries(QUALITY_PRESETS[name].values).every(([key, value]) => settings[key] === value)) ?? null;
// settings a preset decides: changing one by hand turns the preset into 'custom'
const PRESET_FIELDS = Object.keys(QUALITY_PRESETS.high.values);

export const RENDER_DEFAULTS = {
    renderPreset: 'auto',
    renderResolution: 'auto',
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
    if (key === 'renderResolution') return RESOLUTION_CHOICES.includes(value);
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
    // a named preset is re-applied (its definition may have changed); Auto starts where it got to last time
    const preset = values.renderPreset === 'auto' ? loadAuto().level : values.renderPreset;
    return QUALITY_PRESETS[preset] ? { ...values, ...QUALITY_PRESETS[preset].values } : values;
}

// Auto's last level and pixel ratio on this device (validated; the top when none)
function loadAuto() {
    try {
        const saved = JSON.parse(localStorage.getItem(AUTO_KEY));
        return {
            level: Object.hasOwn(QUALITY_PRESETS, saved?.level) ? saved.level : AUTO_START,
            dpr: AUTO_DPR_STEPS.includes(saved?.dpr) ? saved.dpr : MAX_DPR
        };
    } catch {
        return { level: AUTO_START, dpr: MAX_DPR };
    }
}
function saveAuto(level, dpr) {
    try { localStorage.setItem(AUTO_KEY, JSON.stringify({ level, dpr })); } catch { /* this visit only */ }
}

/*
* AUTO LADDER: the steps Auto moves along, best first, as [quality level | null, pixel ratio | null] (null =
* that part is forced by the user and never moves). Effects go before sharpness (a blurry, noisier image
* shows more than missing reflections, especially on a phone):
*   both Auto:       Ultra @ max -> High @ max -> Medium @ max -> Medium @ 1.5 -> Low @ 1.5 -> Low @ 1
*   quality only:    Ultra -> High -> Medium -> Low
*   resolution only: max -> 1.5 -> 1
*/
export function autoLadder(settings) {
    const isQualityAuto = settings.renderPreset === 'auto';
    const isResolutionAuto = settings.renderResolution === 'auto';
    const dprs = AUTO_DPR_STEPS;
    if (isQualityAuto && isResolutionAuto) {
        const [top, last] = [dprs[0], dprs[dprs.length - 1]];
        const mid = dprs.length > 2 ? dprs[1] : top;
        // every level but Low at full sharpness first, then Medium sharper-to-softer, then Low
        const sharp = [...PRESET_ORDER].reverse().filter((level) => level !== 'low').map((level) => [level, top]);
        return [...sharp, ...(mid !== top ? [['medium', mid]] : []), ['low', mid], ...(last !== mid ? [['low', last]] : [])];
    }
    if (isQualityAuto) return [...PRESET_ORDER].reverse().map((level) => [level, null]);
    if (isResolutionAuto) return dprs.map((dpr) => [null, dpr]);
    return [];
}
// Index of the current step in the ladder (-1 when the settings match none of its steps)
export function autoStepIndex(settings, autoDpr) {
    const level = currentQualityLevel(settings);
    return autoLadder(settings).findIndex(([q, d]) => (q === null || q === level) && (d === null || d === autoDpr));
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

    // Resolution: 'auto' or a forced pixel ratio (RESOLUTION_CHOICES), saved on this device
    setRenderResolution: (resolution) =>
        set((state) => {
            if (!RESOLUTION_CHOICES.includes(resolution)) return {};
            const settings = { ...state.settings, renderResolution: resolution };
            saveRenderSettings(settings);
            return { settings };
        }),

    // Pixel ratio chosen by the auto resolution: starts where Auto got to last time on this device
    autoDpr: loadAuto().dpr,

    // One step along the AUTO LADDER (autoLadder): direction +1 = down (cheaper), -1 = up (better). Only the
    // parts set to Auto move. The step reached is remembered on this device (next visit starts there).
    // Returns whether something changed. Settings off the ladder (e.g. Custom effects with Auto resolution at
    // a ratio not in it) count as its top.
    stepAuto: (direction) => {
        let changed = false;
        set((state) => {
            const { settings, autoDpr } = state;
            const ladder = autoLadder(settings);
            const index = Math.max(0, autoStepIndex(settings, autoDpr));
            const target = ladder[index + direction];
            if (!target) return {};
            changed = true;
            const [level, dpr] = target;
            const next = level === null ? settings : { ...settings, ...QUALITY_PRESETS[level].values };
            if (level !== null) saveRenderSettings(next);
            const nextDpr = dpr ?? autoDpr;
            saveAuto(level ?? currentQualityLevel(settings) ?? AUTO_START, nextDpr);
            return { settings: next, autoDpr: nextDpr };
        });
        return changed;
    },

    toggleGridSnap: () =>
        set((state) => ({
            settings: { ...state.settings, gridSnap: !state.settings.gridSnap }
        }))
})