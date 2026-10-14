import { DEFAULT_CITY_ID, dayOfYear } from '../../components/scene/sun/sun';

/*
* Sun settings of the environment, read by the sun light (components/light/Light.jsx) and edited in the
* sun panel (components/ui/sun-panel/SunPanel.jsx):
*   cityId   - location from CITIES (components/scene/sun/sun.js)
*   day      - day of the year, 1..365 (the year is the current one: it only matters for DST)
*   minutes  - local clock time of the city, minutes after midnight (0..1439)
*   northDeg - where geographic north points, degrees clockwise from the room's back wall direction (-Z)
*/
export const createSunSlice = (set) => ({
    sun: {
        cityId: DEFAULT_CITY_ID,
        day: dayOfYear(new Date()),
        minutes: 15 * 60,
        northDeg: 0
    },

    // Merges a partial update, e.g. setSun({ minutes: 600 })
    setSun: (patch) => set((state) => ({ sun: { ...state.sun, ...patch } })),

    // Sun arc helper (components/scene/sun/SunArc.jsx): per device, never synced. showSunArc() shows it
    // and hides it ARC_HIDE_DELAY ms after the last call (called on every day/time slider change).
    sunArcVisible: false,
    showSunArc: () => {
        clearTimeout(arcTimer);
        arcTimer = setTimeout(() => set({ sunArcVisible: false }), ARC_HIDE_DELAY);
        set({ sunArcVisible: true });
    }
});

const ARC_HIDE_DELAY = 1500;
let arcTimer;
