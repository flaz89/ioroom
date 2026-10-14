import { useStore } from '../store/appStore';

/*
* Sun settings shared by everyone in the room (store `sun`, see store/slices/sunSlice.js): the environment
* keeps its location, orientation, day and time. Called by connectRoom (roomSync.js); returns the unbind function.
*
* Model: a Y.Map "sun" with one key per field (cityId, northDeg, day, minutes), so two people moving
* different sliders never overwrite each other; same field = last writer wins.
* - First sync: a room that already has sun settings imposes them on this device; a room without them
*   (new, or created before this feature) is seeded with this device's current values.
*   Local edits made before the first sync are not sent (they would race the room's saved values).
* - local -> room: only the fields whose value changed.
* - room -> local: remote day/time changes also flash the sun arc, so everyone sees the sun move.
* ACCESS: only the owner changes location and north (UI rule in SunPanel.jsx).
* ponytail: enforced by the UI only; the server accepts any field from anyone. Validate on the server
* (per-field write rules) when guests are not trusted.
*/
const FIELDS = ['cityId', 'northDeg', 'day', 'minutes'];
const LOCAL = Symbol('local-sun'); // transaction origin of this device's own sun edits

export function bindSun(doc, provider) {
    const ySun = doc.getMap('sun');
    let isSynced = false;
    let applyingRemote = false; // true while room values are written into the store (no echo back)

    // room -> local: the room's values replace the local ones
    const pull = () => {
        const patch = {};
        for (const field of FIELDS) if (ySun.has(field)) patch[field] = ySun.get(field);
        applyingRemote = true;
        useStore.getState().setSun(patch);
        applyingRemote = false;
    };

    // local -> room: write the given fields of `sun`
    const push = (sun, fields) => {
        doc.transact(() => {
            for (const field of fields) ySun.set(field, sun[field]);
        }, LOCAL);
    };

    const onSynced = (synced) => {
        if (!synced || isSynced) return;
        isSynced = true;
        if (ySun.size === 0) push(useStore.getState().sun, FIELDS); // new room: seed it
        else pull();
    };
    provider.on('synced', onSynced);
    if (provider.synced) onSynced(true);

    const unsubscribe = useStore.subscribe((state, previousState) => {
        if (!isSynced || applyingRemote || state.sun === previousState.sun) return;
        const changed = FIELDS.filter((field) => state.sun[field] !== previousState.sun[field]);
        if (changed.length > 0) push(state.sun, changed);
    });

    const observe = (event) => {
        if (event.transaction.origin === LOCAL) return;
        pull();
        if (event.keysChanged.has('day') || event.keysChanged.has('minutes')) useStore.getState().showSunArc();
    };
    ySun.observe(observe);

    return () => {
        provider.off('synced', onSynced);
        unsubscribe();
        ySun.unobserve(observe);
    };
}
