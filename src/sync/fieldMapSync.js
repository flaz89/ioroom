import { useStore } from '../store/appStore';

/*
* Keeps a flat store object (key -> plain value) identical to the Y.Map `name` of the room document, one
* Y.Map key per field: two people changing different fields never overwrite each other; same field =
* last writer wins. Used for the environment settings (sun: sunSync.js, room surfaces: roomSync.js).
*
* - First sync: a room that already has values imposes them on this device; a room without any (new, or
*   created before the feature) is seeded with this device's current values.
*   Local edits made before the first sync are not sent (they would race the room's saved values).
* - local -> room: only the fields whose value changed (fields removed locally are deleted).
* - room -> local: `write(patch)` with the room's values; `onRemote(keysChanged)` after remote changes.
*
* options: { name, read(state) -> object, write(patch), onRemote? }. Returns the unbind function.
*/
const LOCAL = Symbol('local-field-map'); // transaction origin of this device's own edits

export function bindFieldMap(doc, provider, { name, read, write, onRemote }) {
    const yMap = doc.getMap(name);
    let isSynced = false;
    let applyingRemote = false; // true while room values are written into the store (no echo back)

    // room -> local: the room's values replace the local ones
    const pull = () => {
        applyingRemote = true;
        write(Object.fromEntries(yMap.entries()));
        applyingRemote = false;
    };

    // local -> room: write the given fields of `values` (undefined = deleted)
    const push = (values, fields) => {
        doc.transact(() => {
            for (const field of fields) {
                if (values[field] === undefined) yMap.delete(field);
                else yMap.set(field, values[field]);
            }
        }, LOCAL);
    };

    const onSynced = (synced) => {
        if (!synced || isSynced) return;
        isSynced = true;
        if (yMap.size === 0) push(read(useStore.getState()), Object.keys(read(useStore.getState()))); // new room: seed it
        else pull();
    };
    provider.on('synced', onSynced);
    if (provider.synced) onSynced(true);

    const unsubscribe = useStore.subscribe((state, previousState) => {
        const values = read(state);
        const previous = read(previousState);
        if (!isSynced || applyingRemote || values === previous) return;
        const fields = new Set([...Object.keys(values), ...Object.keys(previous)]);
        const changed = [...fields].filter((field) => values[field] !== previous[field]);
        if (changed.length > 0) push(values, changed);
    });

    const observe = (event) => {
        if (event.transaction.origin === LOCAL) return;
        pull();
        onRemote?.(event.keysChanged);
    };
    yMap.observe(observe);

    return () => {
        provider.off('synced', onSynced);
        unsubscribe();
        yMap.unobserve(observe);
    };
}
