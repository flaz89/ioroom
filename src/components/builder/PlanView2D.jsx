import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../../store/appStore';
import { activeLevel, levelBounds, levelVertices, moveVertex, wallFootprint, wallFrame } from '../../plan/planModel';
import { fitView, gridPath, gridSteps, panBy, toScreen, toWorld, zoomAt } from './planView';
import { publishCameraHeading } from '../scene/sun/cameraHeading';
import WallPanel from './WallPanel';
import './plan-view.css';

const WHEEL_ZOOM_SPEED = 0.0015; // zoom factor per wheel delta unit (exp scale: same feel in and out)
const CLICK_SLOP = 4;            // px: a press that moves less than this is a click (selects), not a pan
const VERTEX_RADIUS = 6;         // px: visible corner handle
const VERTEX_HIT_RADIUS = 14;    // px: touch-friendly invisible hit area around each handle
const LABEL_OFFSET = 14;         // px: length labels sit this far inside the room from the wall's inner line

/*
* 2D top view of the floor plan (builder mode, view '2d', store/slices/workspaceSlice.js): grid in meters,
* floors, walls with their real thickness (mitered corners from planModel.js).
* Drawn over the 3D canvas, inside the same scene card (Scene.jsx). It reads the store `plan`, so it shows
* remote and undo changes as they arrive.
*
* Editing (plan editor):
* - click a wall = select it (orange, length shown) and open its panel (WallPanel.jsx: length, thickness,
*   height); click on empty space or Esc = deselect;
* - drag a corner handle = move that corner: joined walls and the floor follow (planModel.moveVertex),
*   snapped to the grid snap step when grid snap is on (right toolbar). The drag is a local DRAFT, written
*   to the plan once on release: one undo step, one sync message (others see the result, not the motion).
*
* Navigation: drag = pan (mouse, pen, one finger), wheel = zoom at the cursor, two fingers = pinch zoom + pan.
* The camera ({ cx, cz, scale }, planView.js) is per view instance: fitted to the level when first shown.
* ponytail: the 3D canvas keeps rendering under this view; pause it (frameloop) if the GPU cost shows.
*/
export default function PlanView2D() {
    const plan = useStore((state) => state.plan);
    const level = activeLevel(plan);

    const svgRef = useRef();
    const [size, setSize] = useState(null);   // { w, h } in pixels, null until measured
    const [view, setView] = useState(null);   // camera, null until fitted
    const pointersRef = useRef(new Map());    // pointerId -> { x, y } of the pointers down on the view

    // Size of the view (and first fit to the level once the size is known)
    useLayoutEffect(() => {
        const svg = svgRef.current;
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setSize({ w: width, h: height });
            // first non-empty size: fit the level being worked on
            if (width > 0) setView((current) => current
                ?? fitView(levelBounds(activeLevel(useStore.getState().plan)), width, height));
        });
        observer.observe(svg);
        return () => observer.disconnect();
    }, []);

    // Wheel zoom: native listener, not passive (React's onWheel is passive: it could not stop page zoom/scroll)
    useEffect(() => {
        const svg = svgRef.current;
        const onWheel = (event) => {
            event.preventDefault();
            const rect = svg.getBoundingClientRect();
            const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED);
            setView((current) => current && zoomAt(current, rect.width, rect.height,
                event.clientX - rect.left, event.clientY - rect.top, factor));
        };
        svg.addEventListener('wheel', onWheel, { passive: false });
        return () => svg.removeEventListener('wheel', onWheel);
    }, []);

    // EDITING STATE (per device, never synced)
    const setActiveLevel = useStore((state) => state.setActiveLevel);
    const [selectedWallId, setSelectedWallId] = useState(null);
    const [draft, setDraft] = useState(null); // { level, point } while a corner is dragged: preview, not saved
    // Current one-pointer gesture: { kind: 'pan', wallId, start, moved } | { kind: 'vertex', from }
    const gestureRef = useRef(null);
    const shown = draft?.level ?? level;      // what is drawn: the draft while dragging

    // Esc deselects the wall
    useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') setSelectedWallId(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Pointer position relative to the view
    const localPoint = (event) => {
        const rect = svgRef.current.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    // World point under the pointer, on the grid snap step when grid snap is on (settingSlice.js, in cm)
    const snappedWorld = (point) => {
        const [x, z] = toWorld(view, size.w, size.h, point.x, point.y);
        const { gridSnap, gridSnapStep } = useStore.getState().settings;
        if (!gridSnap) return [x, z];
        const step = gridSnapStep / 100;
        return [Math.round(x / step) * step, Math.round(z / step) * step];
    };

    // What the press started on: a corner handle (data-vertex), a wall (data-wall-id) or empty space
    const onPointerDown = (event) => {
        svgRef.current.setPointerCapture(event.pointerId);
        const point = localPoint(event);
        pointersRef.current.set(event.pointerId, point);
        if (pointersRef.current.size > 1) { // second finger: pinch, any corner drag is dropped
            gestureRef.current = null;
            setDraft(null);
            return;
        }
        const { vertex, wallId } = event.target.dataset ?? {};
        gestureRef.current = vertex != null
            ? { kind: 'vertex', from: levelVertices(level)[Number(vertex)] }
            : { kind: 'pan', wallId: wallId ?? null, start: point, moved: false };
    };

    // One pointer: corner drag or pan. Two pointers: zoom by the change of their distance, at their
    // midpoint, plus pan by the midpoint's movement.
    const onPointerMove = (event) => {
        const pointers = pointersRef.current;
        const previous = pointers.get(event.pointerId);
        if (previous == null || size == null || view == null) return;
        const point = localPoint(event);
        const gesture = gestureRef.current;
        if (pointers.size === 1 && gesture?.kind === 'vertex') {
            const to = snappedWorld(point);
            const next = moveVertex(level, gesture.from, to);
            if (next) setDraft({ level: next, point: to }); // invalid (wall too short): keep the last valid one
        } else if (pointers.size === 1) {
            if (gesture && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > CLICK_SLOP) gesture.moved = true;
            setView((current) => current && panBy(current, point.x - previous.x, point.y - previous.y));
        } else if (pointers.size === 2) {
            const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
            const before = Math.hypot(previous.x - other.x, previous.y - other.y);
            const after = Math.hypot(point.x - other.x, point.y - other.y);
            const midBefore = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
            const midAfter = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
            setView((current) => current && zoomAt(
                panBy(current, midAfter.x - midBefore.x, midAfter.y - midBefore.y),
                size.w, size.h, midAfter.x, midAfter.y, before > 0 ? after / before : 1));
        }
        pointers.set(event.pointerId, point);
    };

    // Release: a corner drag is saved (one undo step); a press that did not move is a click (select)
    const onPointerUp = (event) => {
        pointersRef.current.delete(event.pointerId);
        const gesture = gestureRef.current;
        if (pointersRef.current.size > 0 || gesture == null) return;
        if (gesture.kind === 'vertex' && draft) setActiveLevel(draft.level);
        if (gesture.kind === 'pan' && !gesture.moved) setSelectedWallId(gesture.wallId);
        gestureRef.current = null;
        setDraft(null);
    };

    // Lost pointer (system gesture, capture lost): drop the gesture, never save a half drag
    const onPointerCancel = (event) => {
        pointersRef.current.delete(event.pointerId);
        gestureRef.current = null;
        setDraft(null);
    };

    const isReady = size != null && view != null;
    const steps = isReady ? gridSteps(view.scale) : null;

    // Grid scale shown in the bottom bar (PlanGridLegend.jsx): published while this view is open
    const setPlanGrid = useStore((state) => state.setPlanGrid);
    const minorStep = steps?.minor;
    useEffect(() => {
        if (minorStep != null) setPlanGrid(gridSteps(view.scale));
    }, [minorStep]); // eslint-disable-line react-hooks/exhaustive-deps -- republish only when the step changes
    useEffect(() => () => setPlanGrid(null), [setPlanGrid]);

    // Compass bar: the top of the plan is the room's -Z axis, i.e. room heading 0 (cameraHeading.js);
    // the camera tracker pauses while this view is open (CameraHeadingTracker.jsx)
    useEffect(() => publishCameraHeading(0), []);

    return (
        <>
        <svg
            ref={svgRef}
            className="plan-view"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
        >
            {isReady && (
                // world (meters) -> screen: view center at the middle, `scale` px per meter.
                // Strokes use vector-effect="non-scaling-stroke": widths stay in pixels at any zoom.
                <g transform={`translate(${size.w / 2} ${size.h / 2}) scale(${view.scale}) translate(${-view.cx} ${-view.cz})`}>
                    <path className="plan-grid-minor" d={gridPath(view, size.w, size.h, steps.minor)} vectorEffect="non-scaling-stroke" />
                    <path className="plan-grid-major" d={gridPath(view, size.w, size.h, steps.major)} vectorEffect="non-scaling-stroke" />

                    {shown.floors.map((floor) => (
                        <polygon key={floor.id} className="plan-floor" points={floor.points.join(' ')} vectorEffect="non-scaling-stroke" />
                    ))}

                    {shown.walls.map((wall) => {
                        // inner line a -> b, then back along the mitered outer line
                        const { a, b, bOut, aOut } = wallFootprint(wall, shown.walls);
                        return (
                            <polygon
                                key={wall.id}
                                data-wall-id={wall.id}
                                className={wall.id === selectedWallId ? 'plan-wall is-selected' : 'plan-wall'}
                                points={[a, b, bOut, aOut].join(' ')}
                                vectorEffect="non-scaling-stroke"
                            />
                        );
                    })}

                    {/* corner handles: invisible touch-size hit circle + visible dot (radii in px -> meters) */}
                    {levelVertices(shown).map((vertex, index) => (
                        <g key={index}>
                            <circle className="plan-vertex-hit" data-vertex={index} cx={vertex[0]} cy={vertex[1]} r={VERTEX_HIT_RADIUS / view.scale} />
                            <circle className="plan-vertex" cx={vertex[0]} cy={vertex[1]} r={VERTEX_RADIUS / view.scale} vectorEffect="non-scaling-stroke" />
                        </g>
                    ))}
                </g>
            )}

            {/* length labels (screen space, constant size): the selected wall, and the walls of the dragged corner */}
            {isReady && shown.walls
                .filter((wall) => wall.id === selectedWallId || (draft && (samePoint(wall.a, draft.point) || samePoint(wall.b, draft.point))))
                .map((wall) => {
                    const { normal, length } = wallFrame(wall);
                    const [mx, my] = toScreen(view, size.w, size.h, (wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2);
                    // inside the room = opposite to the outward normal (screen y = world z)
                    return (
                        <text key={wall.id} className="plan-length" x={mx - normal[0] * LABEL_OFFSET} y={my - normal[1] * LABEL_OFFSET}>
                            {`${length.toFixed(2)} m`}
                        </text>
                    );
                })}

        </svg>
        {selectedWallId && <WallPanel level={level} wallId={selectedWallId} onClose={() => setSelectedWallId(null)} />}
        </>
    );
}

// Same corner (exact: the dragged point is copied into the walls by moveVertex)
const samePoint = (p, q) => p[0] === q[0] && p[1] === q[1];
