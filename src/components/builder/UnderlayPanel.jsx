import { useRef, useState } from 'react';
import CircleButton from '../ui/circle-button/CircleButton';
import { svg } from '../../utils/svg-logos';
import { useStore } from '../../store/appStore';
import { UNDERLAY_DEFAULTS, activeLevel, levelBounds, nominalMetersPerPixel } from '../../plan/planModel';
import { UNDERLAY_ACCEPT, prepareUnderlay, uploadUnderlay } from '../../plan/underlayFile';
import { UNIT_METERS } from '../../plan/dxfUnderlay';
import './underlay-panel.css';

const SCALE_RANGE = [1, 10000];  // 1:1 .. 1:10000
const DPI_RANGE = [10, 2400];

// Underlay adjustment tools (PlanView2D.jsx: two clicks each, in the 2D plan) and what to do with them
const TOOLS = [
    ['calibrate', 'Calibrate', 'Click two points of the drawing whose real distance you know, then type it.'],
    ['align', 'Align', 'Click two points along a line of the drawing (e.g. a wall): it turns straight.'],
    ['move', 'Move', 'Click a point of the drawing, then where it must go (snaps to wall corners).']
];

/*
* Floor plan UNDERLAY panel (builder, left toolbar; store openPanel 'underlay'): a drawing to trace walls on
* (planModel.js level.underlay, saved with the environment: one undo step per change).
* - No underlay: "Load a plan" (image, PDF first page, or DXF): prepared in the browser, uploaded to R2
*   (plan/underlayFile.js), placed with its center on the plan's center at the default nominal scale (a DXF:
*   at its exact size, from its units).
* - Underlay: Show / Hide and Opacity (this device only, store underlayVisible / underlayOpacity), nominal
*   scale 1:N ("calibrated" once Calibrate is used) and, for images, the scan resolution (dpi: a PDF knows
*   its paper size); for a DXF instead: its units (read from the file, can be corrected) and its layers, each
*   switched on / off (saved: everyone sees the same); the adjustment tools Calibrate / Align / Move (store underlayTool, 2D plan), Replace,
*   Remove.
* ponytail: owner only for now (uploads need the admin token); no PDF page choice (first page).
*/
export default function UnderlayPanel() {
    const isOpen = useStore((state) => state.openPanel === 'underlay');
    const togglePanel = useStore((state) => state.togglePanel);
    const level = useStore((state) => activeLevel(state.plan));
    const setActiveLevel = useStore((state) => state.setActiveLevel);
    const isVisible = useStore((state) => state.underlayVisible);
    const opacity = useStore((state) => state.underlayOpacity);
    const setUnderlayVisible = useStore((state) => state.setUnderlayVisible);
    const setUnderlayOpacity = useStore((state) => state.setUnderlayOpacity);
    const underlayTool = useStore((state) => state.underlayTool);
    const setUnderlayTool = useStore((state) => state.setUnderlayTool);
    const fileRef = useRef();
    const [status, setStatus] = useState(null); // null | 'loading' | error message
    const underlay = level.underlay;

    // Writes the underlay into the level being worked on (the store's current one: no stale closure)
    const saveUnderlay = (next) => {
        const current = activeLevel(useStore.getState().plan);
        const { underlay: _old, ...rest } = current; // the level without its underlay (removed when next is null)
        setActiveLevel(next ? { ...rest, underlay: next } : rest);
    };

    // A file chosen: prepare, upload, place (a replaced underlay keeps its position and rotation)
    const onFile = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = ''; // the same file can be chosen again
        if (file == null) return;
        setStatus('loading');
        try {
            const prepared = await prepareUnderlay(file);
            const url = await uploadUnderlay(prepared.blob);
            const placement = {
                center: underlay?.center ?? levelBounds(activeLevel(useStore.getState().plan)).center,
                rotation: underlay?.rotation ?? 0
            };
            if (prepared.kind === 'dxf') {
                const { blob: _blob, ...info } = prepared; // the blob is uploaded, not saved
                saveUnderlay({ ...info, url, metersPerPixel: UNIT_METERS[prepared.units], hiddenLayers: [], ...placement });
                setUnderlayVisible(true);
                setStatus(null);
                return;
            }
            const nominal = {
                dpi: prepared.dpi ?? UNDERLAY_DEFAULTS.dpi,
                downscale: prepared.downscale,
                scale: underlay?.scale ?? UNDERLAY_DEFAULTS.scale
            };
            saveUnderlay({
                url,
                kind: prepared.kind,
                width: prepared.width,
                height: prepared.height,
                ...nominal,
                metersPerPixel: nominalMetersPerPixel(nominal),
                ...placement
            });
            setUnderlayVisible(true);
            setStatus(null);
        } catch (error) {
            setStatus(error.message);
        }
    };

    // Nominal scale / dpi edited: the size follows (applied on Enter or blur, ignored when out of range)
    const applyNominal = (field, range) => (text) => {
        const value = Number(String(text).replace(',', '.'));
        if (!(value >= range[0] && value <= range[1]) || underlay == null) return;
        const next = { ...underlay, [field]: value };
        saveUnderlay({ ...next, metersPerPixel: nominalMetersPerPixel(next) });
    };

    // DXF units chosen: exact size again (a calibration is dropped)
    const applyUnits = (units) => {
        const { scale: _calibrated, ...rest } = underlay; // a calibration is dropped
        saveUnderlay({ ...rest, units, metersPerPixel: UNIT_METERS[units] });
    };

    // DXF layer switched on / off
    const toggleLayer = (name) => {
        const hidden = underlay.hiddenLayers ?? [];
        saveUnderlay({ ...underlay, hiddenLayers: hidden.includes(name) ? hidden.filter((layer) => layer !== name) : [...hidden, name] });
    };

    return (
        <div className="underlay-control">
            <CircleButton svg={svg.underlay} onClick={() => togglePanel('underlay')} isActive={isOpen} title="Floor plan underlay" />
            {isOpen && (
                <div className="underlay-panel">
                    <span className="underlay-title">Plan underlay</span>
                    <input ref={fileRef} type="file" accept={UNDERLAY_ACCEPT} hidden onChange={onFile} />

                    {underlay == null ? (
                        <>
                            <span className="underlay-hint">An image, a PDF or a DXF (CAD) of the floor plan, to draw the walls over it.</span>
                            <button className="underlay-primary" disabled={status === 'loading'} onClick={() => fileRef.current.click()}>
                                {status === 'loading' ? 'Loading…' : 'Load a plan'}
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="underlay-toggle">
                                <button className={isVisible ? 'is-active' : undefined} onClick={() => setUnderlayVisible(true)}>Show</button>
                                <button className={!isVisible ? 'is-active' : undefined} onClick={() => setUnderlayVisible(false)}>Hide</button>
                            </div>
                            <label className="underlay-row">
                                <span>Opacity <b>{Math.round(opacity * 100)}%</b></span>
                                <input type="range" min={0.1} max={1} step={0.05} value={opacity}
                                    onChange={(event) => setUnderlayOpacity(Number(event.target.value))} />
                            </label>
                            {underlay.kind === 'dxf' ? (
                                <>
                                    <label className="underlay-row underlay-number">
                                        <span>Units</span>
                                        <select value={underlay.scale === null ? '' : underlay.units} onChange={(event) => applyUnits(event.target.value)}>
                                            {underlay.scale === null && <option value="" disabled>calibrated</option>}
                                            {Object.keys(UNIT_METERS).map((units) => <option key={units} value={units}>{units}</option>)}
                                        </select>
                                    </label>
                                    <div className="underlay-row">
                                        <span>Layers</span>
                                        <div className="underlay-layers">
                                            {underlay.layers.map((name) => (
                                                <label key={name}>
                                                    <input type="checkbox" checked={!underlay.hiddenLayers?.includes(name)} onChange={() => toggleLayer(name)} />
                                                    <span title={name}>{name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <NumberRow label="Scale 1:" value={underlay.scale} placeholder="calibrated" onApply={applyNominal('scale', SCALE_RANGE)} />
                            )}
                            {underlay.kind === 'image' && (
                                <NumberRow label="Resolution (dpi)" value={underlay.dpi} onApply={applyNominal('dpi', DPI_RANGE)} />
                            )}
                            {/* adjustment tools: click again (or Esc) to leave */}
                            <div className="underlay-toggle">
                                {TOOLS.map(([tool, label]) => (
                                    <button key={tool} className={underlayTool === tool ? 'is-active' : undefined}
                                        onClick={() => { setUnderlayVisible(true); setUnderlayTool(underlayTool === tool ? null : tool); }}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                            {underlayTool && <span className="underlay-hint">{TOOLS.find(([tool]) => tool === underlayTool)[2]} Esc to cancel.</span>}
                            <div className="underlay-actions">
                                <button disabled={status === 'loading'} onClick={() => fileRef.current.click()}>
                                    {status === 'loading' ? 'Loading…' : 'Replace'}
                                </button>
                                <button className="is-danger" onClick={() => saveUnderlay(null)}>Remove</button>
                            </div>
                        </>
                    )}
                    {status != null && status !== 'loading' && <span className="underlay-error">{status}</span>}
                </div>
            )}
        </div>
    );
}

/*
* Number field, applied on Enter or blur (one undo step per change). Re-created (key) when the value
* changes from outside (undo, another device), so it always starts from the current value.
*/
function NumberRow({ label, value, placeholder, onApply }) {
    const shown = value == null ? '' : String(value);
    return (
        <label className="underlay-row underlay-number">
            <span>{label}</span>
            <input
                key={shown}
                type="text"
                inputMode="decimal"
                defaultValue={shown}
                placeholder={placeholder}
                onBlur={(event) => { if (event.target.value !== shown) onApply(event.target.value); event.target.value = shown; }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') event.target.blur();
                    if (event.key === 'Escape') { event.target.value = shown; event.target.blur(); }
                }}
            />
        </label>
    );
}
