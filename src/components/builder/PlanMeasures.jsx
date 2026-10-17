import { useStore } from '../../store/appStore';
import { formatLength } from '../scene/measure/measureSnap';
import { toScreen } from './planView';

/*
* RULER IN THE 2D PLAN (builder, view '2d'): the same measures as the 3D ruler (store `measures`,
* measuresSlice.js: my temporary ones + the saved shared ones), seen from above. A measure taken here is
* a 3D measure at floor level (or at the height of a first point taken in 3D), so it shows in 3D too.
* - Drawn in screen space (constant size): line, end dots, label with the TRUE 3D length. Measures that
*   are (almost) vertical are a point from above: not drawn.
* - Label click = select (actions under it: Save for my temporary ones, Delete, ×). My selected temporary
*   measure (editableId) gets a drag handle on each end (data-measure-end; the drag is PlanView2D.jsx's).
* - Snap targets of the 2D ruler (PlanView2D.jsx, planView.rulerSnap2D): wall footprint corners and faces,
*   opening corners and jambs, ends and lines of the measures already taken (planView.js: planMeasureList,
*   rulerTargets).
* ponytail: ends anchored on objects are drawn at their stored point (objects are frozen in the builder).
*/
const LOCAL_COLOR = '#ff9a1a';
const AXIS_COLORS = { x: '#ff5252', z: '#3ddc84' }; // same as the 3D ruler (X red, Z green)
const SNAP_COLORS = { vertex: '#3ddc84', edge: '#ffd23f' };
const LABEL_HEIGHT = 20;      // px
const CHAR_WIDTH = 7.5;       // px, label text (monospace)

/*
* SVG layer (screen space) of the measures + the ruler preview.
* preview: null | { start: [x, z] | null, point: [x, z], kind, axis, length } (the snapped point under the
* pointer, and the live measure from the first point).
*/
export function PlanMeasures({ view, size, list, selectedId, editableId, preview }) {
    const editable = list.find((item) => item.id === editableId);
    const screen = (p) => toScreen(view, size.w, size.h, p[0], p[1]);
    return (
        <g className="plan-measures">
            {list.map((item) => (
                <MeasureMark key={item.id} a={screen(item.a)} b={screen(item.b)} color={item.color}
                    text={formatLength(item.length)} measureId={item.id} selected={item.id === selectedId} />
            ))}
            {editable && ['a', 'b'].map((which) => {
                const [x, y] = screen(editable[which]);
                return <circle key={which} className="plan-measure-handle" cx={x} cy={y} r={7} data-measure-id={editable.id} data-measure-end={which} />;
            })}
            {preview?.start && (
                <MeasureMark a={screen(preview.start)} b={screen(preview.point)} color={AXIS_COLORS[preview.axis] ?? LOCAL_COLOR}
                    text={formatLength(preview.length)} dashed />
            )}
            {preview && (() => {
                const [x, y] = screen(preview.point);
                return <circle className="plan-measure-snap" cx={x} cy={y} r={5} fill={SNAP_COLORS[preview.kind] ?? '#ffffff'} />;
            })()}
        </g>
    );
}

// One measure: line, end dots, label at the middle (clickable when it has a measureId)
function MeasureMark({ a, b, color, text, measureId, selected = false, dashed = false }) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const width = text.length * CHAR_WIDTH + 16;
    return (
        <g>
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={2} strokeDasharray={dashed ? '6 4' : undefined} pointerEvents="none" />
            <circle cx={a[0]} cy={a[1]} r={3.5} fill={color} pointerEvents="none" />
            <circle cx={b[0]} cy={b[1]} r={3.5} fill={color} pointerEvents="none" />
            <rect
                className={measureId ? 'plan-measure-label' : undefined}
                data-measure-id={measureId}
                x={mx - width / 2} y={my - LABEL_HEIGHT / 2} width={width} height={LABEL_HEIGHT} rx={LABEL_HEIGHT / 2}
                fill={selected ? 'rgba(40, 30, 10, 0.92)' : 'rgba(10, 16, 32, 0.85)'} stroke={color} strokeWidth={selected ? 2.5 : 1.5}
                pointerEvents={measureId ? undefined : 'none'}
            />
            <text className="plan-measure-text" x={mx} y={my}>{text}</text>
        </g>
    );
}

/*
* Actions of the selected measure, under its label (HTML over the plan): Save (my temporary ones: shares it
* with the room), Delete, × (deselect). Same buttons as the 3D ruler (measures.css).
*/
export function PlanMeasureActions({ view, size, list }) {
    const selectedId = useStore((state) => state.measures.selectedId);
    const item = list.find((entry) => entry.id === selectedId);
    if (item == null) return null;
    const { selectMeasure, saveMeasure, removeMeasure } = useStore.getState();
    const [x, y] = toScreen(view, size.w, size.h, (item.a[0] + item.b[0]) / 2, (item.a[1] + item.b[1]) / 2);
    return (
        <div className="plan-measure-actions" style={{ left: x, top: y + LABEL_HEIGHT / 2 + 6 }} onPointerDown={(event) => event.stopPropagation()}>
            <div className="measure-actions">
                {!item.saved && <button className="primary" onClick={() => saveMeasure(item.id)} title="Save and share with the room">Save</button>}
                <button onClick={() => removeMeasure(item.id)} title="Delete this measure">Delete</button>
                <button onClick={() => selectMeasure(null)} aria-label="Close">×</button>
            </div>
        </div>
    );
}
