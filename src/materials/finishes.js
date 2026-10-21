/*
* SYSTEM FINISHES (doors and windows first; not in the database, no textures, nothing to load): a record
* with a `finish` { color, roughness, metalness } and maps null. NOT listed in the library (decision of
* Flavio: the doors & windows tab offers the custom paint ball, plus the textures the admin uploads): they are
* the parts' defaults (doorModel.DEFAULT_PART_MATERIALS) and whatever paint color is picked.
* - PAINT, any color: id 'paint:#rrggbb' (the color picker writes it); WHITE and ANTHRACITE are two presets.
* - FIXED finishes: 'finish:<key>' (FIXED_FINISHES).
* finishMaterial(id) -> the record (the same object for the same id), or null for any other id (a library
* material).
*/
const PAINT_PREFIX = 'paint:';
const PAINT = { roughness: 0.5, metalness: 0 };
export const paintId = (hex) => `${PAINT_PREFIX}${hex.toLowerCase()}`;
export const WHITE_ID = paintId('#f1eee8');
export const ANTHRACITE_ID = paintId('#3b3e42');
const FIXED_FINISHES = {
    'wood-light': { name: 'Light wood', kind: 'wood', color: '#c9a77c', roughness: 0.6, metalness: 0 },
    'wood-dark': { name: 'Dark wood', kind: 'wood', color: '#5e3f2a', roughness: 0.6, metalness: 0 },
    steel: { name: 'Steel', kind: 'metal', color: '#a9adb2', roughness: 0.35, metalness: 0.4 } // a high metalness looks black without an env map
};
export const STEEL_ID = 'finish:steel';
// kind: the chip it shows under in the library (grouping.js)
const finishRecord = (id, name, kind, finish) => ({ id, name, kind, category: 'fixture', tileSize: 1, maps: null, finish });

// one record per id (cached): store selectors (useMaterial) must get the same object every time
const records = new Map();
export function finishMaterial(id) {
    if (typeof id !== 'string') return null;
    if (!records.has(id)) records.set(id, buildFinish(id));
    return records.get(id);
}

function buildFinish(id) {
    if (id.startsWith(PAINT_PREFIX) && /^#[0-9a-f]{6}$/.test(id.slice(PAINT_PREFIX.length))) {
        const color = id.slice(PAINT_PREFIX.length);
        const name = id === WHITE_ID ? 'White' : id === ANTHRACITE_ID ? 'Anthracite' : `Paint ${color}`;
        return finishRecord(id, name, 'paint', { color, ...PAINT });
    }
    const fixed = id.startsWith('finish:') && FIXED_FINISHES[id.slice('finish:'.length)];
    if (!fixed) return null;
    const { name, kind, ...finish } = fixed;
    return finishRecord(id, name, kind, finish);
}

