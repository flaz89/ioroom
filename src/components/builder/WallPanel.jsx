import { useStore } from '../../store/appStore';
import { useEffect } from 'react';
import { WALL_LIMITS, activeLevel, setWallLength, updateWall, wallFrame } from '../../plan/planModel';
import './plan-view.css';

/*
* Panel of the wall selected in the builder (store selectedWallId: 2D plan or 3D scene), mounted by Scene.jsx
* in builder mode: length, thickness and height, in meters. × or Esc deselects.
* A value is applied on Enter or when the field loses focus (one edit = one undo step, history.js), not on
* every keystroke. Invalid values (empty, out of range, a wall that would collapse) are ignored and the
* field goes back to the current value.
* - Length: the wall's start stays fixed, its end slides along the wall (walls joined there follow).
* - Height: shows the level's default height until set on this wall (wall.height).
*/
export default function WallPanel() {
    const wallId = useStore((state) => state.selectedWallId);
    const level = useStore((state) => activeLevel(state.plan));
    const setSelectedWallId = useStore((state) => state.setSelectedWallId);
    const setActiveLevel = useStore((state) => state.setActiveLevel);
    const onClose = () => setSelectedWallId(null);

    // Esc deselects (also in the 3D view, where the plan view's own Esc handler is not mounted)
    const isOpen = wallId != null;
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (event) => { if (event.key === 'Escape') setSelectedWallId(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, setSelectedWallId]);

    const wall = level.walls.find((item) => item.id === wallId);
    if (wall == null) return null; // nothing selected, or removed (undo, another device)

    const { length } = wallFrame(wall);
    const height = wall.height ?? level.wallHeight;

    // Parses the field (accepts "2,5" as well as "2.5"); NaN when not a number
    const parse = (text) => Number(String(text).replace(',', '.'));

    const applyLength = (value) => {
        const next = setWallLength(level, wallId, value);
        if (next) setActiveLevel(next);
    };
    const applyRange = (field) => (value) => {
        const { min, max } = WALL_LIMITS[field];
        if (value >= min && value <= max) setActiveLevel(updateWall(level, wallId, { [field]: value }));
    };

    return (
        <div className="wall-panel" onPointerDown={(event) => event.stopPropagation()}>
            <div className="wall-panel-header">
                <span>{wall.name ?? wall.id}</span>
                <button className="wall-panel-close" onClick={onClose} title="Deselect (Esc)">×</button>
            </div>
            <Field label="Length" value={length} onApply={(text) => applyLength(parse(text))} />
            <Field label="Thickness" value={wall.thickness} onApply={(text) => applyRange('thickness')(parse(text))} />
            <Field label="Height" value={height} onApply={(text) => applyRange('height')(parse(text))} />
        </div>
    );
}

/*
* Number field in meters. Uncontrolled, re-created (key) whenever the value changes from outside (drag,
* undo, another device), so it always starts from the current value. Enter applies and blurs, Esc reverts.
*/
function Field({ label, value, onApply }) {
    const shown = value.toFixed(2);
    const apply = (input) => {
        if (input.value !== shown) onApply(input.value);
        input.value = shown; // invalid -> back to the current value; valid -> replaced by the new key anyway
    };
    return (
        <label className="wall-panel-field">
            <span>{label}</span>
            <input
                key={shown}
                type="text"
                inputMode="decimal"
                defaultValue={shown}
                onBlur={(event) => apply(event.target)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') event.target.blur();
                    if (event.key === 'Escape') { event.target.value = shown; event.target.blur(); event.stopPropagation(); }
                }}
            />
            <span className="wall-panel-unit">m</span>
        </label>
    );
}
