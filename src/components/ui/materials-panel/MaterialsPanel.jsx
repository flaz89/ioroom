import { useEffect, useRef, useState } from 'react';
import CircleButton from '../circle-button/CircleButton';
import { svg } from '../../../utils/svg-logos';
import { useStore } from '../../../store/appStore';
import { usePanelInViewport } from '../usePanelInViewport';
import { listMaterials } from '../../../materials/library';
import { pickSurfaceAt } from '../../scene/level/room/surfacePicker';
import './materials-panel.css';

const GROUPS = [
    { category: 'floor', title: 'Floors' },
    { category: 'wall', title: 'Walls' },
    { category: null, title: 'Basic' }
];

/*
* Materials toolbar button (Unreal / Twinmotion style): a panel next to the left toolbar with the material
* library as shaded balls, grouped by category. Drag a ball onto a wall or the floor: while dragging, the
* surface under the pointer previews the material (orange tint, SurfaceMaterial.jsx); releasing there
* applies it (store `surfaces`, shared with the room). Any material can go on any surface.
* Pointer events (not HTML drag & drop), so the same gesture works with mouse, pen and touch.
* Which surface is under the pointer: surfacePicker.js (answered by the scene, MaterialDropTarget.jsx).
*/
export default function MaterialsPanel() {
    // Open state shared with the other toolbar panels: only one open at a time (store/slices/panelSlice.js)
    const isOpen = useStore((state) => state.openPanel === 'materials');
    const togglePanel = useStore((state) => state.togglePanel);
    const panelRef = useRef();
    usePanelInViewport(panelRef, isOpen);
    const [drag, setDrag] = useState(null); // { material, x, y } while a ball is dragged (ghost ball)
    const materials = listMaterials();

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
        return () => {
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
                    <span className="materials-title">Materials</span>
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
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
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
