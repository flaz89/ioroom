import { useEffect, useRef, useState } from 'react';
import CircleButton from '../circle-button/CircleButton';
import { svg } from '../../../utils/svg-logos';
import { useStore } from '../../../store/appStore';
import { usePanelInViewport } from '../usePanelInViewport';
import { useMaterialList } from '../../../materials/library';
import { deleteMaterial } from '../../../materials/materialsApi';
import { SYNC_HOST, isAdmin } from '../../../sync/roomSync';
import MaterialCreateModal from './MaterialCreateModal';
import { pickSurfaceAt } from '../../scene/level/room/surfacePicker';
import { setCursorGrabbing } from '../../scene/sceneCursor';
import './materials-panel.css';

const GROUPS = [
    { category: 'floor', title: 'Floors' },
    { category: 'wall', title: 'Walls' },
    { category: null, title: 'Basic' }
];

/*
* Materials toolbar button (Unreal / Twinmotion style): a panel next to the left toolbar with the material
* library as shaded balls, grouped by category. Drag a ball onto a wall face or the floor: while dragging, the
* surface under the pointer previews the material (orange tint, SurfaceMesh.jsx); releasing there
* applies it (store `surfaces`, shared with the room). Any material can go on any surface.
* Pointer events (not HTML drag & drop), so the same gesture works with mouse, pen and touch.
* Which surface is under the pointer: surfacePicker.js (answered by the scene, MaterialDropTarget.jsx).
* OWNER (admin token; later pro accounts): "+" uploads a new material (MaterialCreateModal.jsx), "×" on a
* material (any but Plain) deletes it from the library (second press confirms). Surfaces using a deleted
* material turn plain.
*/
const canManage = Boolean(SYNC_HOST) && isAdmin;
export default function MaterialsPanel() {
    // Open state shared with the other toolbar panels: only one open at a time (store/slices/panelSlice.js)
    const isOpen = useStore((state) => state.openPanel === 'materials');
    const togglePanel = useStore((state) => state.togglePanel);
    const panelRef = useRef();
    usePanelInViewport(panelRef, isOpen);
    const [drag, setDrag] = useState(null); // { material, x, y } while a ball is dragged (ghost ball)
    const materials = useMaterialList();
    const [isCreating, setIsCreating] = useState(false);
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
        const { setMaterialDrag, setSurfaceMaterial } = useStore.getState();
        const materialId = drag.material.id;
        const move = (event) => {
            setDrag((current) => current && { ...current, x: event.clientX, y: event.clientY });
            setMaterialDrag({ materialId, surfaceId: pickSurfaceAt(event.clientX, event.clientY) });
        };
        const end = (event) => {
            const surfaceId = event.type === 'pointerup' ? pickSurfaceAt(event.clientX, event.clientY) : null;
            if (surfaceId != null) setSurfaceMaterial(surfaceId, materialId);
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
        // touch: release the implicit capture, so the pointer events follow the finger over the canvas
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        setDrag({ material, x: event.clientX, y: event.clientY });
    };

    return (
        <div className="materials-control">
            <CircleButton svg={svg.materials} onClick={() => togglePanel('materials')} isActive={isOpen} title="Materials" />
            {isOpen && (
                <div className="materials-panel" ref={panelRef}>
                    <div className="materials-header">
                        <span className="materials-title">Materials</span>
                        {canManage && (
                            <button className="materials-add" onClick={() => setIsCreating(true)} title="New material" aria-label="New material">+</button>
                        )}
                    </div>
                    {deleteError && <span className="materials-error" role="alert">{deleteError}</span>}
                    <span className="materials-hint">Drag a material onto a wall or the floor</span>
                    {GROUPS.map((group) => (
                        <div key={group.title} className="materials-group">
                            <span>{group.title}</span>
                            <div className="materials-balls">
                                {materials.filter((material) => material.category === group.category).map((material) => (
                                    <button
                                        key={material.id}
                                        className="materials-item"
                                        title={material.name}
                                        onPointerDown={(event) => startDrag(event, material)}
                                    >
                                        <MaterialBall material={material} />
                                        <span className="materials-name">{material.name}</span>
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
                    ))}
                </div>
            )}
            {isCreating && <MaterialCreateModal onClose={() => setIsCreating(false)} />}
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
function MaterialBall({ material }) {
    const style = material.maps ? { backgroundImage: `url(${material.maps.color})` } : undefined;
    return <span className="material-ball" style={style} aria-hidden="true" />;
}
