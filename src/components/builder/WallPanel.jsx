import { useStore } from '../../store/appStore';
import { useEffect } from 'react';
import { WALL_LIMITS, activeLevel, addOpening, removeOpening, setWallLength, updateOpening, updateWall, wallFrame } from '../../plan/planModel';
import { singleSelectedWall } from '../../store/slices/workspaceSlice';
import './plan-view.css';

/*
* Panel of the walls selected in the builder (store selectedWallIds: 2D plan or 3D scene), mounted by
* Scene.jsx in builder mode. One wall: length, thickness, height (meters), split, delete. Several walls:
* their count, a common thickness / height (applied to all; empty when they differ), delete.
* × or Esc deselects; Delete / Backspace deletes the selection.
* A value is applied on Enter or when the field loses focus (one edit = one undo step, history.js), not on
* every keystroke. Invalid values (empty, out of range, a wall that would collapse) are ignored and the
* field goes back to the current value.
* - Length: the wall's start stays fixed, its end slides along the wall (walls joined there follow).
* - Height: shows the level's default height until set on this wall (wall.height).
* - Door / Window: a new opening (default size) in the widest free stretch of the wall; each opening is
*   listed (click = select it: OpeningPanel) with × to remove it.
* - Split: two walls joined at the middle (the second copies the materials); Delete (or the Del / Backspace
*   key): removes the wall and its materials. Both one undo step.
*/
export default function WallPanel() {
    const isOpening = useStore((state) => state.selectedOpening != null);
    return isOpening ? <OpeningPanel /> : <WallsPanel />;
}

function WallsPanel() {
    const wallId = useStore(singleSelectedWall);
    const selectedIds = useStore((state) => state.selectedWallIds);
    const level = useStore((state) => activeLevel(state.plan));
    const setSelectedWallId = useStore((state) => state.setSelectedWallId);
    const setActiveLevel = useStore((state) => state.setActiveLevel);
    const deleteWalls = useStore((state) => state.deleteWalls);
    const updateWalls = useStore((state) => state.updateWalls);
    const splitWallInHalf = useStore((state) => state.splitWallInHalf);
    const setSelectedOpening = useStore((state) => state.setSelectedOpening);
    const onClose = () => setSelectedWallId(null);

    // Esc deselects (also in the 3D view, where the plan view's own Esc handler is not mounted);
    // Delete / Backspace deletes the wall, unless a text field is being edited
    const isOpen = selectedIds.length > 0;
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (event) => {
            if (event.key === 'Escape') setSelectedWallId(null);
            const isTyping = ['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable;
            if ((event.key === 'Delete' || event.key === 'Backspace') && !isTyping) {
                event.preventDefault();
                deleteWalls(useStore.getState().selectedWallIds);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, setSelectedWallId, deleteWalls]);

    // Parses the field (accepts "2,5" as well as "2.5"); NaN when not a number
    const parse = (text) => Number(String(text).replace(',', '.'));
    const inRange = (field, value) => value >= WALL_LIMITS[field].min && value <= WALL_LIMITS[field].max;

    // SEVERAL WALLS: common thickness / height (null = they differ), delete
    if (selectedIds.length > 1) {
        const walls = level.walls.filter((item) => selectedIds.includes(item.id));
        const common = (read) => (walls.every((item) => read(item) === read(walls[0])) ? read(walls[0]) : null);
        const applyAll = (field) => (text) => {
            const value = parse(text);
            if (inRange(field, value)) updateWalls(walls.map((item) => item.id), { [field]: value });
        };
        return (
            <div className="wall-panel" onPointerDown={(event) => event.stopPropagation()}>
                <div className="wall-panel-header">
                    <span>{`${walls.length} walls`}</span>
                    <button className="wall-panel-close" onClick={onClose} title="Deselect (Esc)">×</button>
                </div>
                <Field label="Thickness" value={common((item) => item.thickness)} onApply={applyAll('thickness')} />
                <Field label="Height" value={common((item) => item.height ?? level.wallHeight)} onApply={applyAll('height')} />
                <div className="wall-panel-actions">
                    <button className="is-danger" onClick={() => deleteWalls(walls.map((item) => item.id))} title="Delete these walls (Del)">Delete</button>
                </div>
            </div>
        );
    }

    const wall = level.walls.find((item) => item.id === wallId);
    if (wall == null) return null; // nothing selected, or removed (undo, another device)

    const { length } = wallFrame(wall);
    const height = wall.height ?? level.wallHeight;

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
            {/* where the drawn line is: one face of the wall (side) or its axis (center); the line stays put */}
            <div className="wall-panel-field">
                <span>Line</span>
                <div className="wall-panel-toggle">
                    <button className={wall.align !== 'center' ? 'is-active' : undefined}
                        onClick={() => setActiveLevel(updateWall(level, wallId, { align: undefined }))} title="The line is a face of the wall">Face</button>
                    <button className={wall.align === 'center' ? 'is-active' : undefined}
                        onClick={() => setActiveLevel(updateWall(level, wallId, { align: 'center' }))} title="The line is the wall axis (half thickness each side)">Axis</button>
                </div>
            </div>
            {(wall.openings ?? []).map((opening) => (
                <div key={opening.id} className="wall-panel-opening">
                    <span className="wall-panel-opening-name" onClick={() => setSelectedOpening({ wallId, openingId: opening.id })} title="Select this opening">{`${opening.type === 'door' ? 'Door' : 'Window'} ${opening.width.toFixed(2)} × ${opening.height.toFixed(2)}`}</span>
                    <button onClick={() => setActiveLevel(removeOpening(level, wallId, opening.id))} title="Remove this opening">×</button>
                </div>
            ))}
            <div className="wall-panel-actions">
                {['door', 'window'].map((type) => {
                    const next = addOpening(level, wallId, type);
                    return (
                        <button key={type} disabled={next == null} onClick={() => setActiveLevel(next)}
                            title={next ? `Add a ${type} in the widest free stretch of the wall` : `No room for a ${type} on this wall`}>
                            {type === 'door' ? '+ Door' : '+ Window'}
                        </button>
                    );
                })}
            </div>
            <div className="wall-panel-actions">
                <button onClick={() => splitWallInHalf(wallId)} title="Split this wall in two at its middle (then drag the new corner in 2D)">Split</button>
                <button className="is-danger" onClick={() => deleteWalls([wallId])} title="Delete this wall (Del)">Delete</button>
            </div>
        </div>
    );
}

/*
* Panel of the selected door / window (store selectedOpening): distance of its start edge from the wall's
* start, width (the start edge stays put), height, sill (windows; doors stand on the floor); doors: hinge side
* (towards the wall's start / end) and opening side (In = the wall's inner side, Out = outer); Delete.
* A value that would make the opening invalid (overlap, past the wall, through the top: planModel
* updateOpening) is ignored, like the wall fields. Esc deselects, Del / Backspace deletes. ← back to the wall.
*/
function OpeningPanel() {
    const { wallId, openingId } = useStore((state) => state.selectedOpening);
    const level = useStore((state) => activeLevel(state.plan));
    const setActiveLevel = useStore((state) => state.setActiveLevel);
    const setSelectedOpening = useStore((state) => state.setSelectedOpening);
    const setSelectedWallId = useStore((state) => state.setSelectedWallId);
    const remove = () => {
        setActiveLevel(removeOpening(activeLevel(useStore.getState().plan), wallId, openingId));
        setSelectedOpening(null);
    };

    useEffect(() => {
        const onKey = (event) => {
            if (event.key === 'Escape') setSelectedOpening(null);
            const isTyping = ['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable;
            if ((event.key === 'Delete' || event.key === 'Backspace') && !isTyping) {
                event.preventDefault();
                remove();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }); // re-bound every render: remove() reads the current ids

    const wall = level.walls.find((item) => item.id === wallId);
    const opening = wall?.openings?.find((item) => item.id === openingId);
    if (opening == null) return null; // removed (undo, another device, wall deleted)

    const start = opening.offset - opening.width / 2;
    const apply = (patch) => {
        const next = updateOpening(level, wallId, openingId, patch);
        if (next) setActiveLevel(next);
    };
    const number = (text) => Number(String(text).replace(',', '.'));
    const isDoor = opening.type === 'door';

    return (
        <div className="wall-panel" onPointerDown={(event) => event.stopPropagation()}>
            <div className="wall-panel-header">
                <button className="wall-panel-close" onClick={() => setSelectedWallId(wallId)} title="Back to the wall">←</button>
                <span>{isDoor ? 'Door' : 'Window'}</span>
                <button className="wall-panel-close" onClick={() => setSelectedOpening(null)} title="Deselect (Esc)">×</button>
            </div>
            <Field label="From start" value={start} onApply={(text) => apply({ offset: number(text) + opening.width / 2 })} />
            <Field label="Width" value={opening.width} onApply={(text) => apply({ width: number(text), offset: start + number(text) / 2 })} />
            <Field label="Height" value={opening.height} onApply={(text) => apply({ height: number(text) })} />
            {!isDoor && <Field label="Sill" value={opening.sill} onApply={(text) => apply({ sill: number(text) })} />}
            {isDoor && <Toggle label="Hinge" value={opening.hinge ?? 'start'} options={[['start', 'Start'], ['end', 'End']]} onChange={(hinge) => apply({ hinge })} />}
            {isDoor && <Toggle label="Opens" value={opening.swing ?? 'in'} options={[['in', 'In'], ['out', 'Out']]} onChange={(swing) => apply({ swing })} />}
            <div className="wall-panel-actions">
                <button className="is-danger" onClick={remove} title="Delete this opening (Del)">Delete</button>
            </div>
        </div>
    );
}

// Row of mutually exclusive buttons (options: [[value, text]]), same look as the wall's Line Face / Axis
function Toggle({ label, value, options, onChange }) {
    return (
        <div className="wall-panel-field">
            <span>{label}</span>
            <div className="wall-panel-toggle">
                {options.map(([option, text]) => (
                    <button key={option} className={value === option ? 'is-active' : undefined} onClick={() => onChange(option)}>{text}</button>
                ))}
            </div>
        </div>
    );
}

/*
* Number field in meters. Uncontrolled, re-created (key) whenever the value changes from outside (drag,
* undo, another device), so it always starts from the current value. Enter applies and blurs, Esc reverts.
* value null = several walls with different values: empty field ("mixed" placeholder).
*/
function Field({ label, value, onApply }) {
    const shown = value == null ? '' : value.toFixed(2);
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
                placeholder="mixed"
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
