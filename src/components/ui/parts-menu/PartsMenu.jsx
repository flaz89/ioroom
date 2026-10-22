import { useEffect, useState, useSyncExternalStore } from 'react';
import { xrStore } from '../../../xr/xrStore';
import { useStore } from '../../../store/appStore';
import { activeLevel } from '../../../plan/planModel';
import { openingParts, partMaterialId } from '../../scene/level/room/doorModel';
import { PLAIN_ID, useMaterial, useMaterialList } from '../../../materials/library';
import { finishMaterial, paintId } from '../../../materials/finishes';
import { MATERIAL_CATEGORIES } from '../../../materials/grouping';
import { MaterialBall } from '../materials-panel/MaterialsPanel';
import './parts-menu.css';

/*
* PARTS MENU of a door / window (DESIGNER, desktop): opened by a right click on it (Openings3D.jsx, store
* partsMenu), at the cursor, kept inside the window. One row per part with the material it shows now
* (doorModel.partMaterialId: its own, else the structure's, else its default finish): Frame, Leaf (Sash for a
* window), Handle when it has one.
* A click on a row opens its PICKER below it (one at a time): category tabs like the materials panel
* (grouping.js; it opens on Doors & windows, but ANY library material can go on a part, e.g. a wall's material on
* a flush door), then the balls: DEFAULT (removes the part's own material: back to the structure's / its default
* finish), the category's materials, and a CUSTOM paint (its swatch picks the color; applied when the color
* picker closes, so dragging through colors is not one undo step per color). Plain is not offered: Default
* covers the reset. A ball click = surfacesSlice.setPartMaterial (synced, one undo step); the menu stays open.
* Closed by Esc, a press anywhere outside it (a right click on another opening reopens it there), switching
* mode (workspaceSlice.setWorkspace), or when the opening is gone (deleted by someone in the room).
* Not in XR (no mouse there).
*/
export default function PartsMenu() {
    const isXR = useSyncExternalStore(xrStore.subscribe, () => xrStore.getState().mode != null);
    const menu = useStore((state) => state.partsMenu);
    const level = useStore((state) => activeLevel(state.plan));
    if (isXR || menu == null) return null;
    const wall = level.walls.find((item) => item.openings?.some((opening) => opening.id === menu.openingId));
    const opening = wall?.openings.find((item) => item.id === menu.openingId);
    const parts = opening && openingParts(wall, opening, wall.height ?? level.wallHeight);
    if (parts == null) return null;
    const isWindow = opening.type === 'window';
    const rows = [['frame', 'Frame'], ['leaf', isWindow ? 'Sash' : 'Leaf']];
    if (parts.leaves.some((leaf) => leaf.handle.length)) rows.push(['handle', 'Handle']);
    // keyed: a fresh menu (no part open) for every opening
    return <Menu key={menu.openingId} menu={menu} title={isWindow ? 'Window' : 'Door'} rows={rows} />;
}

function Menu({ menu, title, rows }) {
    const setPartsMenu = useStore((state) => state.setPartsMenu);
    const surfaces = useStore((state) => state.surfaces);
    const [openPart, setOpenPart] = useState(null); // the row whose picker is shown
    useEffect(() => {
        const close = () => setPartsMenu(null);
        // capture: seen before the canvas' handlers can stop it; a press inside the menu keeps it open
        const onPress = (event) => { if (!event.target.closest?.('[data-parts-menu]')) close(); };
        const onKey = (event) => { if (event.key === 'Escape') close(); };
        document.addEventListener('pointerdown', onPress, true);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('pointerdown', onPress, true); document.removeEventListener('keydown', onKey); };
    }, [setPartsMenu]);
    return (
        // kept inside the window: left / top clamped by the menu's approximate size (css width 260px; the picker
        // adds ~190px under its row)
        <div className="parts-menu" role="menu" aria-label={`${title} parts`} data-parts-menu
            style={{ left: `min(${menu.x}px, calc(100vw - 270px))`, top: `min(${menu.y}px, calc(100vh - ${60 + rows.length * 52 + (openPart ? 190 : 0)}px))` }}>
            <span className="parts-menu-title">{title}</span>
            {rows.map(([part, label]) => (
                <div key={part}>
                    <PartRow label={label} materialId={partMaterialId(surfaces, menu.openingId, part)}
                        isOpen={openPart === part} onClick={() => setOpenPart(openPart === part ? null : part)} />
                    {openPart === part && <PartPicker openingId={menu.openingId} part={part} current={surfaces[`${menu.openingId}:${part}`]}
                        // what Default goes back to: the resolution without the part's own material (undefined = missing for ??)
                        fallbackId={partMaterialId({ ...surfaces, [`${menu.openingId}:${part}`]: undefined }, menu.openingId, part)} />}
                </div>
            ))}
        </div>
    );
}

function PartRow({ label, materialId, isOpen, onClick }) {
    const material = useMaterial(materialId);
    return (
        <button className={isOpen ? 'parts-menu-row is-open' : 'parts-menu-row'} role="menuitem" aria-expanded={isOpen} onClick={onClick}>
            <MaterialBall material={material} />
            <span className="parts-menu-label">{label}</span>
            <span className="parts-menu-material">{material.name}</span>
        </button>
    );
}

// current: the part's OWN material id (undefined = default); fallbackId: the material Default shows
function PartPicker({ openingId, part, current, fallbackId }) {
    const [category, setCategory] = useState('fixture');
    const [customColor, setCustomColor] = useState('#2f6f8f');
    const library = useMaterialList().filter((material) => material.id !== PLAIN_ID && material.category === category);
    const custom = finishMaterial(paintId(customColor));
    const fallback = useMaterial(fallbackId);
    const apply = (materialId) => useStore.getState().setPartMaterial(openingId, part, materialId);
    const ball = (material, label, materialId) => (
        <button key={label} className={current === materialId ? 'parts-menu-ball is-active' : 'parts-menu-ball'} title={label} onClick={() => apply(materialId)}>
            <MaterialBall material={material} />
            <span>{label}</span>
        </button>
    );
    return (
        <div className="parts-menu-picker">
            <div className="parts-menu-tabs" role="tablist">
                {MATERIAL_CATEGORIES.map((item) => (
                    <button key={item.id} role="tab" aria-selected={category === item.id} className={category === item.id ? 'is-active' : ''}
                        onClick={() => setCategory(item.id)}>{item.short ?? item.label}</button>
                ))}
            </div>
            <div className="parts-menu-balls">
                {ball(fallback, 'Default', undefined)}
                {library.map((material) => ball(material, material.name, material.id))}
                <div className="parts-menu-custom">
                    {ball(custom, 'Custom', custom.id)}
                    {/* native 'change' = the picker closed with a color: applied once (React's onChange fires on every move) */}
                    <label className="parts-menu-color" title="Pick a color">
                        <input type="color" value={customColor} onChange={(event) => setCustomColor(event.target.value)}
                            ref={(input) => { if (input) input.onchange = () => apply(paintId(input.value)); }} />
                    </label>
                </div>
            </div>
        </div>
    );
}
