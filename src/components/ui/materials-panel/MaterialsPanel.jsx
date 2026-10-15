import { useRef } from 'react';
import CircleButton from '../circle-button/CircleButton';
import { svg } from '../../../utils/svg-logos';
import { useStore } from '../../../store/appStore';
import { usePanelInViewport } from '../usePanelInViewport';
import { PLAIN, ROOM_SURFACES, SURFACE_MATERIALS, textureUrl } from '../../scene/level/room/surfaceMaterials';
import './materials-panel.css';

/*
* Room materials toolbar button: a panel next to the left toolbar with one row per room surface
* (floor, each wall) and the swatches offered for it (store `surfaces`, shared with the room).
* Swatch = the material's color map; "Plain" = the untextured default. "All walls" applies one wall
* material to every wall. Everyone in the room can change them.
*/
const WALLS = ROOM_SURFACES.filter((surface) => surface.kind === 'wall');

export default function MaterialsPanel() {
    // Open state shared with the other toolbar panels: only one open at a time (store/slices/panelSlice.js)
    const isOpen = useStore((state) => state.openPanel === 'materials');
    const togglePanel = useStore((state) => state.togglePanel);
    const surfaces = useStore((state) => state.surfaces);
    const setSurfaceMaterial = useStore((state) => state.setSurfaceMaterial);
    const panelRef = useRef();
    usePanelInViewport(panelRef, isOpen);

    const current = (surfaceId) => surfaces[surfaceId] ?? PLAIN;
    const wallIds = WALLS.map((wall) => current(wall.id));
    const allWalls = wallIds.every((id) => id === wallIds[0]) ? wallIds[0] : null; // null = mixed

    return (
        <div className="materials-control">
            <CircleButton svg={svg.materials} onClick={() => togglePanel('materials')} isActive={isOpen} title="Room materials" />
            {isOpen && (
                <div className="materials-panel" ref={panelRef}>
                    <span className="materials-title">Materials</span>
                    {ROOM_SURFACES.map((surface) => (
                        <SwatchRow key={surface.id} label={surface.name} kind={surface.kind} selected={current(surface.id)}
                            onPick={(materialId) => setSurfaceMaterial(surface.id, materialId)} />
                    ))}
                    <SwatchRow label="All walls" kind="wall" selected={allWalls}
                        onPick={(materialId) => WALLS.forEach((wall) => setSurfaceMaterial(wall.id, materialId))} />
                </div>
            )}
        </div>
    );
}

function SwatchRow({ label, kind, selected, onPick }) {
    return (
        <div className="materials-row">
            <span>{label}</span>
            <div className="materials-swatches">
                {SURFACE_MATERIALS.filter((material) => material.kinds.includes(kind)).map((material) => (
                    <button
                        key={material.id}
                        className={material.id === selected ? 'materials-swatch is-selected' : 'materials-swatch'}
                        style={material.id === PLAIN ? undefined : { backgroundImage: `url(${textureUrl(material.id, 'diff')})` }}
                        title={material.name}
                        aria-label={material.name}
                        aria-pressed={material.id === selected}
                        onClick={() => onPick(material.id)}
                    />
                ))}
            </div>
        </div>
    );
}
