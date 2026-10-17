import { getSelfUser } from '../../sync/presence';

/*
* Ruler measures (components/scene/measure/Measures.jsx).
*
* Measure: { id, a, b, author? } — a / b: END POINTS { p, objectId?, local? }:
*   p = position in BOARD space (real meters, also on the tabletop model);
*   objectId + local = taken ON AN OBJECT: the point in the object mesh's local space, so the end follows
*   the object live (moved, rotated, scaled; Measures.jsx). p is kept as the fallback (object deleted).
*   Older measures stored a / b as plain [x, y, z] arrays: read as { p }.
* - local: MINE, temporary (per device, never synced, gone on reload);
* - items: SAVED ones, shared with the room like the notes (sync: Y.Map "measures", sync/roomSync.js),
*   with the author's name/color. A local measure becomes shared with saveMeasure.
* Per device: `active` (ruler mode: clicks place points), `start` (first point of the measure being
*   taken, null = none), `selectedId` (measure whose actions are shown), `free` (VR: free direction
*   instead of the axis lock; on desktop Shift does it).
* ponytail: anyone deletes any saved measure (no accounts), like the notes.
*/
export const createMeasuresSlice = (set) => ({
    measures: {
        items: [],
        local: [],
        active: false,
        start: null,
        selectedId: null,
        free: false
    },

    setMeasureFree: (free) => set((state) => ({ measures: { ...state.measures, free } })),

    // RULER MODE on/off (closes the toolbar panels and the post-it placing mode; off drops a half-taken measure)
    setMeasuring: (active) => set((state) => ({
        measures: { ...state.measures, active, start: null, selectedId: null },
        notes: active ? { ...state.notes, placing: false } : state.notes,
        openPanel: active ? null : state.openPanel
    })),

    // First point of a measure (null = cancel it)
    setMeasureStart: (start) => set((state) => ({ measures: { ...state.measures, start } })),

    // Second point: a new local (temporary) measure from `start` to `b`
    addMeasure: (b) => set((state) => {
        const { start, local } = state.measures;
        if (start == null) return state;
        return { measures: { ...state.measures, start: null, local: [...local, { id: crypto.randomUUID(), a: start, b }] } };
    }),

    selectMeasure: (selectedId) => set((state) => ({ measures: { ...state.measures, selectedId } })),

    // SAVE a local measure: it becomes shared with the room, signed by this device
    saveMeasure: (id) => set((state) => {
        const measure = state.measures.local.find((item) => item.id === id);
        if (measure == null) return state;
        return {
            measures: {
                ...state.measures,
                local: state.measures.local.filter((item) => item.id !== id),
                items: [...state.measures.items, { ...measure, author: getSelfUser() }],
                selectedId: null
            }
        };
    }),

    // MOVE an end ('a' | 'b') of one of MY temporary measures (saved ones are shared: not editable here).
    // end: { p } (a moved end is not anchored on an object anymore)
    moveMeasureEnd: (id, which, end) => set((state) => ({
        measures: { ...state.measures, local: state.measures.local.map((m) => (m.id === id ? { ...m, [which]: end } : m)) }
    })),

    // DELETE a measure (local or saved)
    removeMeasure: (id) => set((state) => ({
        measures: {
            ...state.measures,
            local: state.measures.local.filter((item) => item.id !== id),
            items: state.measures.items.filter((item) => item.id !== id),
            selectedId: state.measures.selectedId === id ? null : state.measures.selectedId
        }
    })),

    // DELETE all my temporary measures
    clearLocalMeasures: () => set((state) => ({ measures: { ...state.measures, local: [], selectedId: null } })),

    // REPLACE ALL saved measures: received from the shared room
    setMeasureItems: (items) => set((state) => ({ measures: { ...state.measures, items } }))
});
