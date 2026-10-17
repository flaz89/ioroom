import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../../store/appStore';
import { activeLevel, addWall, levelBounds, levelVertices, moveVertex, nearestVertex, wallFootprint, wallFrame } from '../../plan/planModel';
import { fitView, gridPath, gridSteps, panBy, toScreen, toWorld, zoomAt } from './planView';
import { publishCameraHeading } from '../scene/sun/cameraHeading';
import './plan-view.css';

const WHEEL_ZOOM_SPEED = 0.0015; // zoom factor per wheel delta unit (exp scale: same feel in and out)
const CLICK_SLOP = 4;            // px: a press that moves less than this is a click (selects), not a pan
const VERTEX_RADIUS = 6;         // px: visible corner handle
const VERTEX_HIT_RADIUS = 14;    // px: touch-friendly invisible hit area around each handle
const LABEL_OFFSET = 14;         // px: length labels sit this far inside the room from the wall's inner line
const VERTEX_SNAP_RADIUS = 12;   // px: the wall tool snaps to an existing corner closer than this
const FLIP_GAP = 18;             // px: flip button center, beyond the wall's outer face

/*
* 2D top view of the floor plan (builder mode, view '2d', store/slices/workspaceSlice.js): grid in meters,
* floors, walls with their real thickness (mitered corners from planModel.js).
* Drawn over the 3D canvas, inside the same scene card (Scene.jsx). It reads the store `plan`, so it shows
* remote and undo changes as they arrive.
*
* Editing (plan editor):
* - click a wall = select it (orange, length shown; store selectedWallId, shared with the 3D view) and open
*   its panel (WallPanel.jsx, mounted by Scene.jsx: length, thickness, height); empty space or Esc = deselect; the round button at the middle of the selected wall
*   moves its thickness to the other side of its line (planSlice.flipWallSide);
* - drag a corner handle = move that corner: joined walls and the floor follow (planModel.moveVertex),
*   snapped to the grid snap step when grid snap is on (right toolbar). The drag is a local DRAFT, written
*   to the plan once on release: one undo step, one sync message (others see the result, not the motion).
* - WALL TOOL (store planTool 'wall', button in the left toolbar): click = place a point; each click after
*   the first adds a wall from the previous point (chain), one undo step per wall. Points snap to existing
*   corners (orange ring) or to the grid snap step. The chain ends on a click on an existing corner (the
*   new wall joins it), on a second click on the same point (double click) or with Esc; Esc again leaves
*   the tool. Walls drawn clockwise get their thickness outside (planModel.addWall). Drag still pans.
*
* Navigation: right (or middle) mouse drag = pan, like the 3D view (OrbitControls); left mouse drag pans
* nothing (clicks only). Touch / pen: one finger drag = pan. Wheel = zoom at the cursor, two fingers = pinch
* zoom + pan.
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
    const selectedWallId = useStore((state) => state.selectedWallId);   // shared with the 3D view
    const setSelectedWallId = useStore((state) => state.setSelectedWallId);
    const [draft, setDraft] = useState(null); // { level, point } while a corner is dragged: preview, not saved
    // Current one-pointer gesture: { kind: 'pan', wallId, start, moved } | { kind: 'vertex', from }
    const gestureRef = useRef(null);
    const shown = draft?.level ?? level;      // what is drawn: the draft while dragging

    // WALL TOOL STATE
    const planTool = useStore((state) => state.planTool);
    const setPlanTool = useStore((state) => state.setPlanTool);
    const isDrawing = planTool === 'wall';
    const [chain, setChain] = useState(null); // [x, z]: last placed point of the wall being drawn, null = none
    const [hover, setHover] = useState(null); // { point, kind: 'vertex' | 'grid' | 'free' } under the mouse
    // Tool changed (toolbar button, Esc): start clean, no chain (state reset during render; the store's
    // setPlanTool clears the selection)
    const [toolSeen, setToolSeen] = useState(planTool);
    if (toolSeen !== planTool) {
        setToolSeen(planTool);
        setChain(null);
        setHover(null);
    }

    // Esc: ends the wall chain, else leaves the wall tool, else deselects the wall
    useEffect(() => {
        const onKey = (event) => {
            if (event.key !== 'Escape') return;
            if (chain) setChain(null);
            else if (isDrawing) setPlanTool('select');
            else setSelectedWallId(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [chain, isDrawing, setPlanTool, setSelectedWallId]);

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

    // Wall tool point under the pointer: an existing corner nearby wins over the grid
    const snapPoint = (point) => {
        const [x, z] = toWorld(view, size.w, size.h, point.x, point.y);
        const vertex = nearestVertex(level, [x, z], VERTEX_SNAP_RADIUS / view.scale);
        if (vertex) return { point: vertex, kind: 'vertex' };
        const snapped = snappedWorld(point);
        return { point: snapped, kind: useStore.getState().settings.gridSnap ? 'grid' : 'free' };
    };

    // Wall tool click: first point starts the chain, the next ones add walls (see the header)
    const placePoint = ({ point, kind }) => {
        if (chain == null) { setChain(point); return; }
        const next = addWall(level, chain, point);
        if (next == null) { setChain(null); return; } // same point again (double click): end
        setActiveLevel(next);
        setChain(kind === 'vertex' ? null : point);    // joined an existing corner: end, else continue
    };

    // What the press started on: a corner handle (data-vertex), a wall (data-wall-id) or empty space.
    // With the wall tool every press is a click-or-pan (corners are snap targets, not handles).
    const onPointerDown = (event) => {
        svgRef.current.setPointerCapture(event.pointerId);
        const point = localPoint(event);
        pointersRef.current.set(event.pointerId, point);
        if (pointersRef.current.size > 1) { // second finger: pinch, any corner drag is dropped
            gestureRef.current = null;
            setDraft(null);
            return;
        }
        // mouse: right / middle button = pan only (never a click); left button never pans
        const isMouse = event.pointerType === 'mouse';
        if (isMouse && event.button !== 0) {
            gestureRef.current = { kind: 'pan', wallId: null, start: point, moved: true, pans: true };
            return;
        }
        const { vertex, wallId } = isDrawing ? {} : (event.target.dataset ?? {});
        gestureRef.current = vertex != null
            ? { kind: 'vertex', from: levelVertices(level)[Number(vertex)] }
            : { kind: 'pan', wallId: wallId ?? null, start: point, moved: false, pans: !isMouse };
    };

    // One pointer: corner drag or pan. Two pointers: zoom by the change of their distance, at their
    // midpoint, plus pan by the midpoint's movement.
    const onPointerMove = (event) => {
        const pointers = pointersRef.current;
        const previous = pointers.get(event.pointerId);
        if (size == null || view == null) return;
        const point = localPoint(event);
        if (isDrawing && pointers.size <= 1) setHover(snapPoint(point)); // preview of the next point (mouse)
        if (previous == null) return;
        const gesture = gestureRef.current;
        if (pointers.size === 1 && gesture?.kind === 'vertex') {
            const to = snappedWorld(point);
            const next = moveVertex(level, gesture.from, to);
            if (next) setDraft({ level: next, point: to }); // invalid (wall too short): keep the last valid one
        } else if (pointers.size === 1) {
            if (gesture && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > CLICK_SLOP) gesture.moved = true;
            if (gesture?.pans) setView((current) => current && panBy(current, point.x - previous.x, point.y - previous.y));
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
        if (gesture.kind === 'pan' && !gesture.moved) {
            if (isDrawing) placePoint(snapPoint(localPoint(event)));
            else setSelectedWallId(gesture.wallId);
        }
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
            className={isDrawing ? 'plan-view is-drawing' : 'plan-view'}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onContextMenu={(event) => event.preventDefault()} // right button pans: no browser menu
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
                                className={wall.id === selectedWallId && !isDrawing ? 'plan-wall is-selected' : 'plan-wall'}
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

                    {/* wall tool: the wall being drawn (dashed, default thickness) and the snapped point */}
                    {isDrawing && chain && hover && previewWall(shown, chain, hover.point)}
                    {isDrawing && chain && <circle className="plan-chain-start" cx={chain[0]} cy={chain[1]} r={VERTEX_RADIUS / view.scale} vectorEffect="non-scaling-stroke" />}
                    {isDrawing && hover?.kind === 'vertex' && (
                        <circle className="plan-snap-ring" cx={hover.point[0]} cy={hover.point[1]} r={VERTEX_SNAP_RADIUS / view.scale} vectorEffect="non-scaling-stroke" />
                    )}
                </g>
            )}

            {/* wall tool: live length of the wall being drawn */}
            {isReady && isDrawing && chain && hover && lengthLabel(view, size, { a: chain, b: hover.point })}

            {/* length labels (screen space, constant size): the selected wall, and the walls of the dragged corner */}
            {isReady && shown.walls
                .filter((wall) => wall.id === selectedWallId || (draft && (samePoint(wall.a, draft.point) || samePoint(wall.b, draft.point))))
                .map((wall) => lengthLabel(view, size, wall))}

        </svg>
        {selectedWallId && !isDrawing && !draft && isReady && (
            <FlipButton view={view} size={size} wall={level.walls.find((wall) => wall.id === selectedWallId)} />
        )}
        </>
    );
}

// Same corner (exact: the dragged point is copied into the walls by moveVertex)
const samePoint = (p, q) => p[0] === q[0] && p[1] === q[1];

// Length label of a wall-like { a, b } (screen space, constant size), offset inside the room
// (opposite to the outward normal; screen y = world z). Null for a zero-length segment.
function lengthLabel(view, size, wall) {
    if (wall.a[0] === wall.b[0] && wall.a[1] === wall.b[1]) return null;
    const { normal, length } = wallFrame(wall);
    const [mx, my] = toScreen(view, size.w, size.h, (wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2);
    return (
        <text key={wall.id ?? 'preview'} className="plan-length" x={mx - normal[0] * LABEL_OFFSET} y={my - normal[1] * LABEL_OFFSET}>
            {`${length.toFixed(2)} m`}
        </text>
    );
}

// Footprint of the wall the tool would add from `a` to `b` (joins included), dashed; null if too short
function previewWall(level, a, b) {
    const next = addWall(level, a, b, 'preview');
    if (next == null) return null;
    const wall = next.walls[next.walls.length - 1];
    const { bOut, aOut } = wallFootprint(wall, next.walls);
    return <polygon className="plan-wall-preview" points={[wall.a, wall.b, bOut, aOut].join(' ')} vectorEffect="non-scaling-stroke" />;
}

/*
* Round button next to the middle of the selected wall, on its OUTER side (the length label is on the inner
* side): moves the thickness to the other side of the line.
* HTML over the SVG (screen space); its own pointerdown stops propagation, so the plan view does not start
* a pan / selection gesture under it. The arrow points along the wall's normal (the thickness direction).
*/
function FlipButton({ view, size, wall }) {
    const flipWallSide = useStore((state) => state.flipWallSide);
    if (wall == null) return null;
    const { normal } = wallFrame(wall);
    const [mx, my] = toScreen(view, size.w, size.h, (wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2);
    const angle = Math.atan2(normal[1], normal[0]) * 180 / Math.PI;
    // outside the wall (the length label sits inside): past the thickness along the normal, plus a gap
    const offset = wall.thickness * view.scale + FLIP_GAP;
    return (
        <button
            className="plan-flip"
            style={{ left: mx + normal[0] * offset, top: my + normal[1] * offset }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => flipWallSide(wall.id)}
            title="Move the thickness to the other side"
        >
            <svg width="16" height="16" viewBox="-8 -8 16 16" style={{ transform: `rotate(${angle}deg)` }}>
                <path d="M-6 0H6M3-3L6 0L3 3M-3-3L-6 0L-3 3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </button>
    );
}
