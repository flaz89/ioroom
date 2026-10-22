import { useEffect, useRef, useState } from 'react';
import CircleButton from '../circle-button/CircleButton';
import { svg } from '../../../utils/svg-logos';
import { useStore } from '../../../store/appStore';
import { usePanelInViewport } from '../usePanelInViewport';
import { preloadMaterialTextures, useMaterialList } from '../../../materials/library';
import { finishMaterial, paintId } from '../../../materials/finishes';
import { MATERIAL_CATEGORIES, kindsIn, visibleMaterials } from '../../../materials/grouping';
import { deleteMaterial } from '../../../materials/materialsApi';
import { SYNC_HOST, isAdmin } from '../../../sync/roomSync';
import MaterialCreateModal from './MaterialCreateModal';
import MaterialCard from './MaterialCard';
import { pickSurfaceAt } from '../../scene/level/room/surfacePicker';
import { setCursorGrabbing } from '../../scene/sceneCursor';
import './materials-panel.css';


/*
* Materials toolbar button (Unreal / Twinmotion style): a panel next to the left toolbar with the material
* library as shaded balls. Tabs by category (Floors / Walls) and chips by kind (Wood, Marble...; only the
* kinds present), materials/grouping.js; the choice is shared with the VR panel (store libraryFilter).
* Plain is the first ball of every tab. Drag a ball onto a wall face or the floor: while dragging, the
* surface under the pointer previews the material (orange tint, SurfaceMesh.jsx); releasing there
* applies it (store `surfaces`, shared with the room). Any material can go on any surface.
* Pointer events (not HTML drag & drop), so the same gesture works with mouse, pen and touch.
* Which surface is under the pointer: surfacePicker.js (answered by the scene, MaterialDropTarget.jsx).
* Holding the mouse on a ball opens its card (big texture, price, manufacturer link): MaterialCard.jsx.
* OWNER (admin token; later pro accounts): "+" uploads a new material (MaterialCreateModal.jsx), "✎" edits
* its name / category / kind / real size (same modal), "×" on a
* material (any but Plain) deletes it from the library (second press confirms). Surfaces using a deleted
* material turn plain.
*/
const canManage = Boolean(SYNC_HOST) && isAdmin;
const CARD_DELAY_MS = 800;
const CARD_CLOSE_MS = 250;
export default function MaterialsPanel() {
    // Open state shared with the other toolbar panels: only one open at a time (store/slices/panelSlice.js)
    const isOpen = useStore((state) => state.openPanel === 'materials');
    const togglePanel = useStore((state) => state.togglePanel);
    const panelRef = useRef();
    usePanelInViewport(panelRef, isOpen);
    const [drag, setDrag] = useState(null); // { material, x, y } while a ball is dragged (ghost ball)
    /*
    * Material card (MaterialCard.jsx): the mouse resting on a ball for CARD_DELAY_MS opens it next to the
    * panel; it stays while the mouse is on that ball or on the card (to click the link) and closes
    * CARD_CLOSE_MS after leaving both. Mouse only (touch and pen drag the balls), never during a drag.
    */
    const [card, setCard] = useState(null); // material shown in the card
    const cardTimer = useRef(null);
    const hoverBall = (event, material) => {
        clearTimeout(cardTimer.current);
        if (event.pointerType !== 'mouse' || material.maps == null) return closeCardSoon();
        if (card?.id === material.id) return;
        cardTimer.current = setTimeout(() => setCard(material), card ? 0 : CARD_DELAY_MS); // already open: switch at once
    };
    const keepCard = () => clearTimeout(cardTimer.current);
    const closeCardSoon = () => {
        clearTimeout(cardTimer.current);
        cardTimer.current = setTimeout(() => setCard(null), CARD_CLOSE_MS);
    };
    useEffect(() => () => clearTimeout(cardTimer.current), []);
    const materials = useMaterialList();
    const [isCreating, setIsCreating] = useState(false);
    const [editing, setEditing] = useState(null); // material record in the edit modal
    const filter = useStore((state) => state.libraryFilter);
    const setLibraryFilter = useStore((state) => state.setLibraryFilter);
    const kinds = kindsIn(materials, filter.category);
    // a chip that no longer has materials (e.g. after an edit) falls back to "All"
    const kind = kinds.some((k) => k.id === filter.kind) ? filter.kind : null;
    // doors & windows tab: a CUSTOM paint ball after the finishes, any color (its picker: the ball's swatch)
    const [customColor, setCustomColor] = useState('#2f6f8f');
    const custom = finishMaterial(paintId(customColor));
    const listed = visibleMaterials(materials, { category: filter.category, kind });
    const shown = filter.category === 'fixture' && (kind == null || kind === 'paint') && !listed.includes(custom) ? [...listed, custom] : listed;
    const [confirmDelete, setConfirmDelete] = useState(null); // id waiting for the confirming press
    const [deleteError, setDeleteError] = useState(null);

    const remove = async (material) => {
        if (confirmDelete !== material.id) return setConfirmDelete(material.id);
        setConfirmDelete(null);
        setDeleteError(null);
        try {
            await deleteMaterial(material.id);
            const { libraryMaterials, setLibraryMaterials } = useStore.getState();
            setLibraryMaterials(libraryMaterials.filter((item) => item.id !== material.id));
        } catch (error) {
            setDeleteError(error.message);
        }
    };

    // Drag in progress: follow the pointer on the whole window, preview / apply on the surface below it
    useEffect(() => {
        if (drag == null) return;
        const { setMaterialDrag, dropMaterial } = useStore.getState();
        const materialId = drag.material.id;
        const move = (event) => {
            setDrag((current) => current && { ...current, x: event.clientX, y: event.clientY });
            setMaterialDrag({ materialId, surfaceId: pickSurfaceAt(event.clientX, event.clientY) });
        };
        const end = (event) => {
            const surfaceId = event.type === 'pointerup' ? pickSurfaceAt(event.clientX, event.clientY) : null;
            // a room face, or a door / window (its whole structure; Shift = all of that type: surfacesSlice)
            if (surfaceId != null) dropMaterial(surfaceId, materialId, { allOfType: event.shiftKey });
            setMaterialDrag(null);
            setDrag(null);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        setCursorGrabbing('material-drag', true); // closed hand everywhere while a ball is dragged
        return () => {
            setCursorGrabbing('material-drag', false);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            setMaterialDrag(null);
        };
    }, [drag?.material]); // eslint-disable-line react-hooks/exhaustive-deps -- re-bind only when a new drag starts, not on every move

    const startDrag = (event, material) => {
        event.preventDefault(); // no text selection / native image drag
        clearTimeout(cardTimer.current);
        setCard(null);
        preloadMaterialTextures(material);
        // touch: release the implicit capture, so the pointer events follow the finger over the canvas
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        setDrag({ material, x: event.clientX, y: event.clientY });
    };

    return (
        <div className="materials-control">
            <CircleButton svg={svg.materials} onClick={() => togglePanel('materials')} isActive={isOpen} title="Materials" />
            {isOpen && (
                <div className="materials-panel" ref={panelRef}>
                    {card != null && drag == null && <MaterialCard material={card} onPointerEnter={keepCard} onPointerLeave={closeCardSoon} />}
                    <div className="materials-header">
                        <span className="materials-title">Materials</span>
                        {canManage && (
                            <button className="materials-add" onClick={() => setIsCreating(true)} title="New material" aria-label="New material">+</button>
                        )}
                    </div>
                    {deleteError && <span className="materials-error" role="alert">{deleteError}</span>}
                    <span className="materials-hint">{filter.category === 'fixture' ? 'Drag onto a door or a window (Shift: all of that kind)' : 'Drag a material onto a wall or the floor'}</span>
                    <div className="materials-tabs" role="tablist">
                        {MATERIAL_CATEGORIES.map((category) => (
                            <button key={category.id} role="tab" aria-selected={filter.category === category.id}
                                className={filter.category === category.id ? 'is-active' : ''}
                                onClick={() => setLibraryFilter({ category: category.id })}>{category.label}</button>
                        ))}
                    </div>
                    {kinds.length > 0 && (
                        <div className="materials-chips">
                            {[{ id: null, label: 'All' }, ...kinds].map((chip) => (
                                <button key={chip.id ?? 'all'} className={kind === chip.id ? 'is-active' : ''}
                                    onClick={() => setLibraryFilter({ kind: chip.id })}>{chip.label}</button>
                            ))}
                        </div>
                    )}
                    <div className="materials-group">
                            <div className="materials-balls">
                                {shown.map((material) => (
                                    <button
                                        key={material.id}
                                        className="materials-item"
                                        title={material.name}
                                        onPointerDown={(event) => startDrag(event, material)}
                                        onPointerEnter={(event) => drag == null && hoverBall(event, material)}
                                        onPointerLeave={closeCardSoon}
                                    >
                                        <MaterialBall material={material} />
                                        <span className="materials-name">{material === custom ? 'Custom' : material.name}</span>
                                        {material === custom && (
                                            // the custom paint's color picker (its own press: never starts a drag)
                                            <label className="materials-edit materials-color" title="Pick a color" onPointerDown={(event) => event.stopPropagation()}>
                                                <input type="color" value={customColor} onChange={(event) => setCustomColor(event.target.value)} />
                                            </label>
                                        )}
                                        {canManage && material.maps != null && (
                                            <span
                                                className="materials-edit"
                                                role="button"
                                                title="Edit material"
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={(event) => { event.stopPropagation(); setEditing(material); }}
                                            >✎</span>
                                        )}
                                        {canManage && material.maps != null && (
                                            <span
                                                className={confirmDelete === material.id ? 'materials-delete is-confirm' : 'materials-delete'}
                                                role="button"
                                                title={confirmDelete === material.id ? 'Press again to delete' : 'Delete material'}
                                                // own press: never starts a drag
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={(event) => { event.stopPropagation(); remove(material); }}
                                            >{confirmDelete === material.id ? '?' : '×'}</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                    </div>
                </div>
            )}
            {isCreating && <MaterialCreateModal initialCategory={filter.category} onClose={() => setIsCreating(false)} />}
            {editing != null && <MaterialCreateModal material={editing} onClose={() => setEditing(null)} />}
            {/* ghost ball following the pointer while dragging */}
            {drag != null && (
                <div className="materials-ghost" style={{ left: drag.x, top: drag.y }}>
                    <MaterialBall material={drag.material} />
                </div>
            )}
        </div>
    );
}

// Material preview ball: the color map wrapped on a disc, shaded like a lit sphere (css)
export function MaterialBall({ material }) {
    const style = material.maps ? { backgroundImage: `url(${material.maps.color})` }
        : material.finish ? { backgroundColor: material.finish.color } : undefined; // a system finish: its color
    return <span className="material-ball" style={style} aria-hidden="true" />;
}
