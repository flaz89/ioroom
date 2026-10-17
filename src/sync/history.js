import * as Y from 'yjs';

/*
* Undo / redo of this device's own edits to the environment (Y.UndoManager on the room document).
*
* - Only LOCAL edits are recorded: in a shared room, undo never reverts what other people did.
* - Tracked maps: objects, notes, saved measures, surface materials, floor plan.
*   NOT tracked: sun (never in the history, by design), prices (frozen automatically), presence.
* - Undo / redo are Yjs transactions with the UndoManager as origin: the room bindings (roomSync.js,
*   fieldMapSync.js) treat them like remote changes, so they reach the store and every other device
*   with no extra code.
*
* Transaction origins (shared by every binding):
* - LOCAL: an edit made by the user on this device -> recorded in the history;
* - SEED:  this device's state written into the room when it connects (initial merge / seeding of an
*          empty map) -> NOT recorded, otherwise the first undo would wipe the whole scene.
*/
export const LOCAL = Symbol('local');
export const SEED = Symbol('seed');

// True for transactions made by this device's bindings (their observers must not echo them back)
export const isOwnOrigin = (origin) => origin === LOCAL || origin === SEED;

const TRACKED_MAPS = ['objects', 'notes', 'measures', 'surfaces', 'plan'];

// Edits closer than this are merged into one undo step. Needed because one user action can touch
// several maps in separate transactions (one per binding, same tick).
// ponytail: time-based grouping; two different actions within 300 ms merge too. Group per gesture
// (undoManager.stopCapturing() at gesture start) if that ever shows up.
const CAPTURE_TIMEOUT_MS = 300;

let undoManager = null;

// Starts recording the edits of `doc` (called by connectRoom); returns the stop function
export function startHistory(doc) {
    undoManager = new Y.UndoManager(TRACKED_MAPS.map((name) => doc.getMap(name)), {
        trackedOrigins: new Set([LOCAL]),
        captureTimeout: CAPTURE_TIMEOUT_MS
    });
    const manager = undoManager;
    return () => {
        manager.destroy();
        if (undoManager === manager) undoManager = null;
    };
}

export const undo = () => undoManager?.undo();
export const redo = () => undoManager?.redo();
