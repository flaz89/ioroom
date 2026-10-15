import { getSelfUser } from '../../sync/presence';

/*
* Post-it notes of the environment (saved and shared like the objects: see sync/roomSync.js).
*
* Note: { id, objectId, p, n, text, author: { name, color } }
* - objectId: the object the note is stuck on (it follows the object), null = room surface (wall, floor);
* - p / n: point and surface normal, in the object's local (unscaled geometry) space when stuck on an
*   object, in board space otherwise;
* - author: name/color of the device that wrote it (no accounts yet: the device name, as in presence.js).
*
* Per device (never synced): `placing` (next click on a surface sticks a note), `draft` (anchor of a
* note being written, not saved yet) and `openId` (note shown in the editor).
* ponytail: anyone in the room edits and deletes any note (no accounts to check against); add owner
* rules with login.
*/
export const createNotesSlice = (set) => ({
    notes: {
        items: [],
        placing: false,
        draft: null,   // { objectId, p, n } while a new note is being written
        openId: null
    },

    // PLACING MODE: on = the next click on a surface opens a new note there (closes the toolbar panels)
    setPlacingNote: (placing) => set((state) => ({
        notes: { ...state.notes, placing },
        openPanel: placing ? null : state.openPanel
    })),

    // NEW NOTE at `anchor` ({ objectId, p, n }): opens the editor, nothing is saved until saveNote
    openNoteDraft: (anchor) => set((state) => ({
        notes: { ...state.notes, placing: false, draft: anchor, openId: null }
    })),

    // EXISTING NOTE: opens the editor
    openNote: (id) => set((state) => ({
        notes: { ...state.notes, placing: false, draft: null, openId: id },
        openPanel: null
    })),

    // Closes the editor (an unsaved draft is dropped)
    closeNote: () => set((state) => ({
        notes: { ...state.notes, draft: null, openId: null }
    })),

    // SAVE the editor's text: creates the draft note, or updates the open one; then closes the editor
    saveNote: (text) => set((state) => {
        const { draft, openId, items } = state.notes;
        const saved = draft != null
            ? [...items, { id: crypto.randomUUID(), ...draft, text, author: getSelfUser() }]
            : items.map((note) => (note.id === openId ? { ...note, text } : note));
        return { notes: { ...state.notes, items: saved, draft: null, openId: null } };
    }),

    // DELETE a note (closes the editor if it was showing it)
    removeNote: (id) => set((state) => ({
        notes: {
            ...state.notes,
            items: state.notes.items.filter((note) => note.id !== id),
            openId: state.notes.openId === id ? null : state.notes.openId
        }
    })),

    // REPLACE ALL: notes received from the shared room; the editor closes if its note is gone
    setNotes: (items) => set((state) => ({
        notes: {
            ...state.notes,
            items,
            openId: items.some((note) => note.id === state.notes.openId) ? state.notes.openId : null
        }
    }))
});
