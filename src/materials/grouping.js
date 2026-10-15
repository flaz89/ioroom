/*
* How the material library is organized in the materials panels (desktop MaterialsPanel.jsx and VR
* xr-ui/VRMaterialsPanel.jsx): tabs by CATEGORY (where it is meant to go: floors / walls), chips by KIND
* (what it is: wood, marble...). Plain (no category) is the first ball of every tab: the "reset".
* The kind list lives only here (the server only checks the shape of the id): add a kind = add a line.
* Records without a kind, or with one not listed here, show under "Other".
*/
export const MATERIAL_CATEGORIES = [
    { id: 'floor', label: 'Floors' },
    { id: 'wall', label: 'Walls' }
];

export const MATERIAL_KINDS = [
    { id: 'wood', label: 'Wood' },
    { id: 'marble', label: 'Marble' },
    { id: 'stone', label: 'Stone' },
    { id: 'tiles', label: 'Tiles / Gres' },
    { id: 'concrete', label: 'Concrete' },
    { id: 'brick', label: 'Brick' },
    { id: 'plaster', label: 'Plaster' },
    { id: 'paint', label: 'Paint' },
    { id: 'fabric', label: 'Fabric' },
    { id: 'metal', label: 'Metal' },
    { id: 'other', label: 'Other' }
];
const KNOWN_KINDS = new Set(MATERIAL_KINDS.map((kind) => kind.id));

export const kindOf = (material) => (KNOWN_KINDS.has(material.kind) ? material.kind : 'other');

// Kinds present in a category, in MATERIAL_KINDS order (the chips worth showing)
export function kindsIn(materials, category) {
    const present = new Set(materials.filter((m) => m.category === category).map(kindOf));
    return MATERIAL_KINDS.filter((kind) => present.has(kind.id));
}

// Balls of a tab: Plain (category null) first, then the category's materials, of one kind (null = all)
export function visibleMaterials(materials, { category, kind }) {
    return materials.filter((m) => m.category == null || (m.category === category && (kind == null || kindOf(m) === kind)));
}
