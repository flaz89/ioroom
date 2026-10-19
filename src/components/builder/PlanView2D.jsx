import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/appStore';
import { activeLevel, addFloor, addWall, fillRoom, floorAt, moveFloorVertex, alignUnderlay, calibrateUnderlay, faceOffsets, moveUnderlay, levelBounds, openingLeaves, openingOperation, openingRects, levelVertices, moveVertex, nearestVertex, newOpeningId, newWallId, updateOpening, wallFootprint, wallFrame } from '../../plan/planModel';
import { alignPoint, angleBetween, angleSnap, fitView, gridPath, gridSteps, lockToPlanAxis, panBy, planMeasureList, NO_TARGETS, rulerTargets, snapWithUnderlay, toScreen, underlayTargets, toWorld, wallsInBox, zoomAt } from './planView';
import { PlanMeasureActions, PlanMeasures } from './PlanMeasures';
import { singleSelectedWall } from '../../store/slices/workspaceSlice';
import { publishCameraHeading } from '../scene/sun/cameraHeading';
import { useUnderlayVectors } from '../../plan/underlayFile';
import { detectedWallShapes, placeDetectedWalls } from '../../plan/dxfWalls';
import { joinTracedWall, traceWall } from '../../plan/traceWall';
import { placeOpening } from '../../plan/placeOpening';
import './plan-view.css';

const WHEEL_ZOOM_SPEED = 0.0015; // zoom factor per wheel delta unit (exp scale: same feel in and out)
const CLICK_SLOP = 4;            // px: a press that moves less than this is a click (selects), not a pan
const VERTEX_RADIUS = 6;         // px: visible corner handle
const VERTEX_HIT_RADIUS = 14;    // px: touch-friendly invisible hit area around each handle
const LABEL_OFFSET = 14;         // px: length labels sit this far inside the room from the wall's inner line
const VERTEX_SNAP_RADIUS = 12;   // px: the wall tool snaps to an existing corner closer than this
const FLIP_GAP = 18;             // px: flip button center, beyond the wall's outer face
const CAD_SNAP_MARK = 5;         // px: radius of the mark of a point snapped on a DXF underlay
const ALIGN_SNAP_RADIUS = 8;     // px: a coordinate this close to another corner's lines up with it
const ANGLE_SNAP_TOLERANCE = 2;  // degrees: a wall direction this close to a multiple of the step snaps to it
const ANGLE_ARC_RADIUS = 28;     // px: angle indicator arc
const WINDOW_MARK_LENGTH = 0.8;  // meters: window symbol, line across the wall (centered on its axis, sticks out)
const LEAF_THICKNESS = 0.03;     // meters: a sliding leaf panel in the plan (and the track spacing)
const SLIDE_GAP = 0.02;          // meters: a sliding leaf off the wall face / its arrow off the leaves
const ARROW_HEAD = 0.08;         // meters: longest arrow head of a sliding leaf

/*
* 2D top view of the floor plan (builder mode, view '2d', store/slices/workspaceSlice.js): grid in meters,
* floors, walls with their real thickness (mitered corners from planModel.js).
* Drawn over the 3D canvas, inside the same scene card (Scene.jsx). It reads the store `plan`, so it shows
* remote and undo changes as they arrive.
*
* Editing (plan editor):
* - click a wall = select it (orange, length shown; store selectedWallIds, shared with the 3D view) and open
*   its panel (WallPanel.jsx, mounted by Scene.jsx: length, thickness, height); empty space or Esc = deselect;
*   Shift+click adds / removes a wall. BOX SELECTION (mouse, left drag): left -> right = window (walls fully
*   inside), right -> left = crossing (walls touched too), Shift adds to the selection (planView.wallsInBox); the round button at the middle of the selected wall
*   moves its thickness to the other side of its line (planSlice.flipWallSide);
* - drag a corner handle = move that corner: joined walls follow, floors stay (planModel.moveVertex),
*   snapped to the grid snap step when grid snap is on (right toolbar). The drag is a local DRAFT, written
*   to the plan once on release: one undo step, one sync message (others see the result, not the motion).
* - WALL TOOL (store planTool 'wall', button in the left toolbar): click = place a point; each click after
*   the first adds a wall from the previous point (chain), one undo step per wall. Points snap to existing
*   corners (orange ring) or to the grid snap step. The chain ends on a click on an existing corner (the
*   new wall joins it), on a second click on the same point (double click) or with Esc; Esc again leaves
*   the tool. Drag still pans. JUSTIFY (hover on the wall button, LeftToolBar.jsx; store wallJustify): the
*   thickness goes on the left of the drawing direction, on the right, or half each side (center: axis
*   line, planModel.addWall).
* - FLOOR TOOL (store planTool 'floor', button in the left toolbar): floors are DRAWN, never built from the
*   walls. Click = place a vertex of the floor polygon; a click on its first point (or on the last one again,
*   double click) or Enter closes it: one floor, one undo step (planModel.addFloor refuses fewer than 3
*   points, no area or crossing edges: the preview turns red). Points snap to wall FACE corners and faces
*   (the floor runs net of the walls, opening jambs included: planView.rulerTargets), to other floors'
*   vertices and edges, to a DXF underlay, then alignment and grid like the wall tool. Esc drops the
*   polygon, Esc again leaves the tool. FILL A ROOM: a double click before a second point fills the closed
*   wall perimeter around it with its clear area (planModel.fillRoom; nothing if no room or already floored).
*   SELECT (floor tool, no polygon being drawn): a click inside a floor selects it (store selectedFloorId; a
*   click on a snap target starts a polygon instead); with a floor selected, a click on empty space only
*   deselects. The selected floor shows its vertex handles: drag = move that vertex with the floor tool's
*   snaps (planModel.moveFloorVertex: refused if the edges would cross; a local draft saved on release, one
*   undo step). Delete / Backspace removes it with its material (planSlice.deleteFloor); Esc deselects.
* - TRACE WALLS (store planTool 'trace', left toolbar button shown with a vector underlay: DXF, later vector
*   PDF): ASSISTED walls. The pointer near a line of the drawing previews the wall measured there (dashed, with
*   length and thickness; plan/traceWall.traceWall: that face's stretch and the parallel face 5-60 cm away) and
*   the joins it would make; click = add it (joinTracedWall: center aligned, ends carried onto the walls they
*   reach, L corners shared), one undo step. Nothing is previewed where no wall is found or where that wall
*   is in the plan already. Esc leaves the tool.
* - DOORS / WINDOWS (store planTool 'opening', type from store openingType, left toolbar): the pointer previews
*   the opening one click would place (highlighted symbol; plan/placeOpening.js): on a wall, between the
*   drawing's jambs around the pointer; in a gap between two walls on one axis, the gap (the two walls become
*   one). Click = place it, one undo step (the merged wall's face materials go: planSlice.setActiveLevelRemoving).
*   Esc leaves the tool.
* - ALIGNMENT GUIDES (wall tool, floor tool and corner drag): a point that lines up horizontally / vertically with
*   another corner (or the chain's last point) snaps to that line and shows it dashed (planView.alignPoint).
*   Priority: exact corner > DXF underlay end point / line (CAD SNAP, below) > alignment (per axis) >
*   angle snap > grid snap. CAD SNAP: a DXF underlay shown here lends its visible lines' end points (green
*   mark) and lines (yellow) to the wall tool, the corner drag, the ruler and the underlay tools.
* - ANGLE (wall tool): the wall being drawn shows its angle (arc + value at its start): the angle between
*   it and the previous wall of the chain, or with the plan's horizontal for a first wall (hidden when
*   straight). With rotation snap on (right toolbar), its direction snaps to multiples of the rotation step
*   from the previous wall (planView.angleSnap) and a dashed guide shows the ray. Dragging a corner shows
*   the angle between its two walls.
* - OPENINGS (doors / windows, planModel wall.openings): drawn as a gap in the wall with the drafting symbol
*   (door: leaf + swing arc, on its hinge side and opening side; window: line on the wall's axis). Click =
*   select it (store selectedOpening; its panel is WallPanel.jsx). DRAG = slide it along its wall (start
*   edge on the grid snap step when grid snap is on; stops at the wall's ends and at the other openings),
*   with live distances from both wall ends; a local draft saved on release (one undo step).
*
* - RULER (toolbar ruler button, store measures.active; PlanMeasures.jsx): the 3D ruler's measures seen
*   from above, and new ones taken here (at floor level). Click = first point, click = measure (temporary,
*   mine; Save shares it). Points snap to wall / opening corners and faces and to existing measures
*   (planView.rulerSnap2D), else to the grid snap step; after the first point the measure is locked to the
*   plan's X or Z axis (planView.lockToPlanAxis), Shift = free. Label click = select (Save / Delete). The
*   ruler wins over the wall tool; Esc is handled by the 3D ruler (Measures.jsx: first point, then off).
*   A selected measure (mine or saved: anyone can edit) shows a handle on each end (ruler on or off): dragging
*   one moves that end with the same snaps, locked to the axis through the other end (Shift = free); the
*   end keeps its height; saved on release (store moveMeasureEnd; a saved measure syncs to the room).
* - UNDERLAY TOOLS (store underlayTool, from UnderlayPanel.jsx; they own the clicks while active):
*   'calibrate' = two points of the drawing (snapped to its end points / lines; the second one locked to the
*   plan's X / Z axis through the first, Shift = free), then their real length (field at the middle) ->
*   rescaled, then centered on the project with the view fitted to it; 'align' = two points along a drawing line -> turned onto the nearest axis around the
*   first point; 'move' = a point of the drawing, then where it goes (snapped to wall corners, else to the
*   grid snap step). One undo step each (planModel calibrateUnderlay / alignUnderlay / moveUnderlay). Esc
*   drops the first point, then leaves the tool.
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
    const selectedWallIds = useStore((state) => state.selectedWallIds);  // shared with the 3D view
    const selectedWallId = useStore(singleSelectedWall);                  // exactly one selected, else null
    const setSelectedWallId = useStore((state) => state.setSelectedWallId);
    const selectedOpening = useStore((state) => state.selectedOpening);
    const selectedOpeningId = selectedOpening?.openingId;
    const [box, setBox] = useState(null);           // { start, end } screen points of the box being dragged
    const [isPanning, setIsPanning] = useState(false); // right / middle mouse pan: grabbing cursor
    const [draft, setDraft] = useState(null); // { level, point } while a corner is dragged: preview, not saved
    const [slide, setSlide] = useState(null); // { level, wallId, openingId } while an opening is dragged: preview
    // Current one-pointer gesture: { kind: 'pan', wallId, start, moved } | { kind: 'vertex', from }
    const gestureRef = useRef(null);
    const [traceHover, setTraceHover] = useState(null); // { level, trace } trace tool: the wall under the pointer, previewed
    const [openingHover, setOpeningHover] = useState(null); // placeOpening result under the pointer (door / window tool)
    const shown = draft?.level ?? slide?.level ?? traceHover?.level ?? openingHover?.level ?? level; // what is drawn: the draft while dragging / the traced wall's preview

    // Floor plan underlay: shown under the plan when this device shows it (store underlayVisible / Opacity)
    const underlay = shown.underlay;
    const isUnderlayVisible = useStore((state) => state.underlayVisible);
    const underlayOpacity = useStore((state) => state.underlayOpacity);
    const wallOpacity = useStore((state) => state.planWallOpacity); // css --wall-opacity: wall and opening fills
    // CAD SNAP (DXF underlay shown): its visible lines' end points and lines are snap targets of the wall
    // tool, the corner drag, the ruler and the underlay tools (planView.snapWithUnderlay: the plan's own
    // corners first). Placed in plan meters once per underlay change.
    const cadTargets = useCadTargets(level.underlay, isUnderlayVisible); // drafts never change the underlay
    // CAD point / line near a screen point (null when none): { point, kind: 'vertex' | 'edge', segment? }
    const cadSnap = (point) => {
        const snap = snapWithUnderlay(toWorld(view, size.w, size.h, point.x, point.y), NO_TARGETS, cadTargets, VERTEX_SNAP_RADIUS / view.scale);
        return snap.kind ? snap : null;
    };

    // WALL TOOL STATE
    const planTool = useStore((state) => state.planTool);
    const wallJustify = useStore((state) => state.wallJustify);
    const setPlanTool = useStore((state) => state.setPlanTool);
    // underlay adjustment tool: wins over the ruler and the wall tool (it needs an underlay)
    const underlayTool = useStore((state) => (activeLevel(state.plan).underlay ? state.underlayTool : null));
    const setUnderlayTool = useStore((state) => state.setUnderlayTool);
    const [toolPoints, setToolPoints] = useState([]);   // [x, z] points placed with the underlay tool
    const [lengthAsk, setLengthAsk] = useState(null);   // { a, b } calibration waiting for its real length
    const [toolHover, setToolHover] = useState(null);   // { point, kind } under the mouse with the underlay tool
    const [underlayToolSeen, setUnderlayToolSeen] = useState(underlayTool);
    if (underlayToolSeen !== underlayTool) { // tool changed: start clean (state reset during render)
        setUnderlayToolSeen(underlayTool);
        setToolPoints([]);
        setLengthAsk(null);
        setToolHover(null);
    }
    const isRuler = useStore((state) => state.measures.active) && underlayTool == null;
    const measures = useStore((state) => state.measures);
    const measureList = planMeasureList(measures);
    // a drawing tool (walls or floors) owns the clicks: walls, openings and corners are snap targets only
    const isDrawing = ['wall', 'floor', 'trace', 'opening'].includes(planTool) && !isRuler && underlayTool == null;
    const isFloorTool = isDrawing && planTool === 'floor';
    const isTraceTool = isDrawing && planTool === 'trace';
    const isOpeningTool = isDrawing && planTool === 'opening';
    const [floorPoints, setFloorPoints] = useState([]); // [x, z] vertices of the floor being drawn
    const selectedFloorId = useStore((state) => state.selectedFloorId);
    const setSelectedFloorId = useStore((state) => state.setSelectedFloorId);
    const [rulerHover, setRulerHover] = useState(null); // { point, kind, axis } snapped ruler point under the mouse
    const [endDrag, setEndDrag] = useState(null); // { id, which, point, kind, axis } while a measure end is dragged: preview
    // the selected measure (mine or saved: anyone can edit it): its ends get drag handles (PlanMeasures.jsx)
    const editableId = measureList.some((m) => m.id === measures.selectedId) ? measures.selectedId : null;
    // what is drawn: the dragged end at its preview position (true 3D length: heights kept)
    const shownMeasures = endDrag == null ? measureList : measureList.map((item) => {
        if (item.id !== endDrag.id) return item;
        const moved = { ...item, [endDrag.which]: endDrag.point };
        return { ...moved, length: Math.hypot(moved.b[0] - moved.a[0], moved.yb - moved.ya, moved.b[1] - moved.a[1]) };
    });
    const [chain, setChain] = useState(null); // [x, z]: last placed point of the wall being drawn, null = none
    const [chainPrev, setChainPrev] = useState(null); // [x, z]: start of the chain's last wall (angle reference)
    const [hover, setHover] = useState(null); // { point, kind: 'vertex' | 'grid' | 'free' } under the mouse
    // Tool changed (toolbar button, Esc): start clean, no chain (state reset during render; the store's
    // setPlanTool clears the selection)
    const [toolSeen, setToolSeen] = useState(planTool);
    if (toolSeen !== planTool) {
        setToolSeen(planTool);
        setChain(null);
        setHover(null);
        setFloorPoints([]);
        setTraceHover(null);
        setOpeningHover(null);
    }

    // Esc: ends the wall chain / drops the floor being drawn, else leaves the tool, else deselects the wall.
    // Enter: closes the floor being drawn.
    useEffect(() => {
        const onKey = (event) => {
            const isTyping = ['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable;
            if ((event.key === 'Delete' || event.key === 'Backspace') && isFloorTool && selectedFloorId && !isTyping) {
                event.preventDefault();
                useStore.getState().deleteFloor(selectedFloorId);
                return;
            }
            if (event.key === 'Enter' && isFloorTool && floorPoints.length > 0) {
                const next = addFloor(activeLevel(useStore.getState().plan), floorPoints); // as closeFloor (below)
                if (next) { setActiveLevel(next); setFloorPoints([]); }
                return;
            }
            if (event.key !== 'Escape') return;
            if (underlayTool) {
                if (toolPoints.length > 0 || lengthAsk) { setToolPoints([]); setLengthAsk(null); } else setUnderlayTool(null);
                return;
            }
            if (chain) setChain(null);
            else if (floorPoints.length > 0) setFloorPoints([]);
            else if (selectedFloorId) setSelectedFloorId(null);
            else if (isDrawing) setPlanTool('select');
            else setSelectedWallId(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [chain, isDrawing, isFloorTool, floorPoints, selectedFloorId, setSelectedFloorId, setActiveLevel, setPlanTool, setSelectedWallId, underlayTool, toolPoints, lengthAsk, setUnderlayTool]);

    // UNDERLAY TOOL point under the pointer (screen point): the second point of 'move' snaps to a wall
    // corner, else to the grid snap step; the other points pick a spot of the drawing: free, or on a DXF's
    // end point / line (exact calibration, alignment and move). CALIBRATE's second point is locked to the
    // plan's X or Z axis through the first one, like the ruler (planView.lockToPlanAxis: on a line it stops
    // where the axis crosses it); `free` (Shift) = any direction, still snapped.
    const underlayToolPoint = (point, free = false) => {
        if (underlayTool === 'move' && toolPoints.length === 1) {
            const raw = toWorld(view, size.w, size.h, point.x, point.y);
            const vertex = nearestVertex(level, raw, VERTEX_SNAP_RADIUS / view.scale);
            if (vertex) return { point: vertex, kind: 'vertex' };
            return { point: snappedWorld(point), kind: 'grid' };
        }
        const raw = toWorld(view, size.w, size.h, point.x, point.y);
        const snap = cadSnap(point) ?? { point: raw, kind: null };
        if (underlayTool === 'calibrate' && toolPoints.length === 1 && !free) {
            return { point: lockToPlanAxis(toolPoints[0], raw, snap).point, kind: snap.kind ?? 'free' };
        }
        return { point: snap.point, kind: snap.kind ?? 'free' };
    };

    // Underlay tool click: first point, then the second one applies the tool ('calibrate' asks the length first)
    const placeUnderlayPoint = ({ point }) => {
        if (lengthAsk) return; // waiting for the length field
        if (toolPoints.length === 0) { setToolPoints([point]); return; }
        const [a] = toolPoints;
        const underlay = level.underlay;
        if (underlayTool === 'calibrate') { setLengthAsk({ a, b: point }); setToolPoints([a, point]); return; }
        const next = underlayTool === 'align' ? alignUnderlay(underlay, a, point) : moveUnderlay(underlay, a, point);
        if (next) setActiveLevel({ ...level, underlay: next });
        setUnderlayTool(null);
    };

    // Calibration length entered (meters; "4,20" or "4.20"): applied, tool done; invalid = asked again.
    // The rescaled drawing is then CENTERED on the project (the plan's bounds center; the grid's origin area
    // when there are no walls yet) and the view fitted to it: rescaling around the first point could send it
    // far away.
    const applyCalibration = (text) => {
        const length = Number(String(text).replace(',', '.'));
        const scaled = lengthAsk && calibrateUnderlay(level.underlay, lengthAsk.a, lengthAsk.b, length);
        if (!scaled) return false;
        const center = levelBounds(level).center;
        const next = { ...scaled, center };
        setActiveLevel({ ...level, underlay: next });
        setUnderlayTool(null);
        const half = Math.max(next.width, next.height) * next.metersPerPixel / 2;
        setView(fitView({ min: [center[0] - half, center[1] - half], max: [center[0] + half, center[1] + half], center }, size.w, size.h));
        return true;
    };

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

    // Wall tool point under the pointer: an existing corner nearby wins over the grid; then a DXF underlay's
    // end point or line (kind 'cad': not a corner of the plan, the chain goes on; cadKind for the mark)
    const snapPoint = (point) => {
        const [x, z] = toWorld(view, size.w, size.h, point.x, point.y);
        const vertex = nearestVertex(level, [x, z], VERTEX_SNAP_RADIUS / view.scale);
        if (vertex) return { point: vertex, kind: 'vertex', guides: [] };
        const cad = cadSnap(point);
        if (cad) return { point: cad.point, kind: 'cad', cadKind: cad.kind, guides: [] };
        const { gridSnap, rotationSnap, rotationSnapStep } = useStore.getState().settings;
        const kind = gridSnap ? 'grid' : 'free';
        const targets = chain ? [...levelVertices(level), chain] : levelVertices(level);
        const tolerance = ALIGN_SNAP_RADIUS / view.scale;
        // alignment wins (per axis, then the grid on the free axis)
        if (alignPoint([x, z], targets, tolerance).guides.length > 0) {
            const aligned = alignPoint(snappedWorld(point), targets, tolerance);
            return { point: aligned.point, kind, guides: aligned.guides };
        }
        // angle snap from the chain's last point, relative to the previous wall (or the plan's X axis)
        if (chain && rotationSnap) {
            const refAngle = chainPrev ? Math.atan2(chain[1] - chainPrev[1], chain[0] - chainPrev[0]) : 0;
            const snapped = angleSnap(chain, [x, z], refAngle, rotationSnapStep, ANGLE_SNAP_TOLERANCE);
            if (snapped) {
                // dashed guide along the ray, a bit past the point
                const reach = Math.hypot(snapped.point[0] - chain[0], snapped.point[1] - chain[1]) + 80 / view.scale;
                const far = [chain[0] + Math.cos(snapped.angle) * reach, chain[1] + Math.sin(snapped.angle) * reach];
                return { point: snapped.point, kind, guides: [{ from: chain, to: far }] };
            }
        }
        return { point: snappedWorld(point), kind, guides: [] };
    };

    // Floor tool point under the pointer (screen point): wall face corners, the floor's own points and other
    // floors' vertices (orange ring), then a DXF end point, wall faces / floor edges, a DXF line (marks like
    // the wall tool's CAD snap), else alignment with those vertices and the grid snap step.
    // skipFloorId: a floor that is not a snap target (the one whose vertex is being dragged)
    const floorSnap = (point, skipFloorId = null) => {
        const raw = toWorld(view, size.w, size.h, point.x, point.y);
        const walls = rulerTargets(level, []); // wall face corners and faces (net of the walls), opening jambs
        const floors = level.floors.filter((floor) => floor.id !== skipFloorId);
        const floorEdges = floors.flatMap((floor) => floor.points.map((p, i) => [p, floor.points[(i + 1) % floor.points.length]]));
        const vertices = [...floorPoints, ...walls.vertices, ...floors.flatMap((floor) => floor.points)];
        const snap = snapWithUnderlay(raw, { vertices, segments: [...walls.segments, ...floorEdges] }, cadTargets, VERTEX_SNAP_RADIUS / view.scale);
        if (snap.kind === 'vertex' && !snap.cad) return { point: snap.point, kind: 'vertex', guides: [], raw };
        if (snap.kind) return { point: snap.point, kind: 'cad', cadKind: snap.kind, guides: [], raw };
        const aligned = alignPoint(snappedWorld(point), vertices, ALIGN_SNAP_RADIUS / view.scale);
        return { point: aligned.point, kind: useStore.getState().settings.gridSnap ? 'grid' : 'free', guides: aligned.guides, raw };
    };

    // Closes the floor being drawn: added if valid (one undo step), else kept on screen (red) to fix or Esc
    const closeFloor = (points) => {
        const next = addFloor(level, points);
        if (next == null) return;
        setActiveLevel(next);
        setFloorPoints([]);
    };

    // Floor tool click: a new vertex; on the first point (or the last one again) the polygon closes
    const placeFloorPoint = ({ point, raw, kind }) => {
        // no polygon being drawn: a click inside a floor (not on a snap target) selects it; with a floor
        // selected, a click on empty space only deselects
        if (floorPoints.length === 0) {
            const hit = kind === 'vertex' || kind === 'cad' ? null : floorAt(level, raw);
            if (hit) return setSelectedFloorId(hit.id);
            if (selectedFloorId) return setSelectedFloorId(null);
        }
        const last = floorPoints[floorPoints.length - 1];
        if (floorPoints.length >= 3 && (samePoint(point, floorPoints[0]) || samePoint(point, last))) return closeFloor(floorPoints);
        if (last && samePoint(point, last)) {
            // double click on the first point: fill the room around it (raw pointer: never on a face); else nothing to close
            if (floorPoints.length === 1) {
                const next = fillRoom(level, raw);
                if (next) setActiveLevel(next);
                setFloorPoints([]);
            }
            return;
        }
        setFloorPoints([...floorPoints, point]);
    };

    // Trace tool: the wall measured on the drawing under the pointer (screen point), joined into the plan
    // (null: no wall there, or already in the plan). Preview id 'preview'; the click adds it with a real id.
    const traceAt = (point, id = 'preview') => {
        const trace = traceWall(toWorld(view, size.w, size.h, point.x, point.y), cadTargets.segments, VERTEX_SNAP_RADIUS / view.scale);
        const next = trace && joinTracedWall(level, trace, id);
        return next ? { level: next, trace } : null;
    };

    // Door / window tool: the opening one click at this screen point would place (null: none); preview id
    // 'preview', the click places it with a real id
    const openingAt = (point, id = 'preview') => placeOpening(level, toWorld(view, size.w, size.h, point.x, point.y),
        useStore.getState().openingType, cadTargets.segments, VERTEX_SNAP_RADIUS / view.scale, { opening: id });

    // Ruler point under the pointer (screen point): snapped (planView.rulerSnap2D), on the grid when it
    // snaps to nothing, then locked to the X / Z axis from the first point unless `free` (Shift)
    // `from`: the fixed point the axis lock starts from ([x, z]; default: the ruler's first point);
    // `excludeId`: a measure that is not a snap target (the one whose end is being dragged)
    const rulerPoint = (point, free, from, excludeId) => {
        const raw = toWorld(view, size.w, size.h, point.x, point.y);
        const state = useStore.getState();
        const others = planMeasureList(state.measures).filter((item) => item.id !== excludeId);
        const { vertices, segments } = rulerTargets(level, others);
        const snap = snapWithUnderlay(raw, { vertices, segments }, cadTargets, VERTEX_SNAP_RADIUS / view.scale);
        if (snap.kind == null) snap.point = snappedWorld(point);
        const start = state.measures.start;
        const origin = from ?? (start ? [start.p[0], start.p[2]] : null);
        if (origin == null || free) return { point: snap.point, kind: snap.kind, axis: null };
        return { ...lockToPlanAxis(origin, raw, snap), kind: snap.kind };
    };

    // Ruler click: first point, or the measure (at the first point's height: floor level when taken here)
    const placeRulerPoint = ({ point }) => {
        const { measures: current, setMeasureStart, addMeasure } = useStore.getState();
        const y = current.start?.p[1] ?? 0;
        const end = { p: [point[0], y, point[1]] };
        if (current.start == null) return setMeasureStart(end);
        if (Math.hypot(point[0] - current.start.p[0], point[1] - current.start.p[2]) < 0.001) return setMeasureStart(null); // same point: cancel
        addMeasure(end);
    };

    // Wall tool click: first point starts the chain, the next ones add walls (see the header)
    const placePoint = ({ point, kind }) => {
        if (chain == null) { setChain(point); setChainPrev(null); return; }
        const next = addWall(level, chain, point, undefined, useStore.getState().wallJustify);
        if (next == null) { setChain(null); return; } // same point again (double click): end
        setActiveLevel(next);
        setChainPrev(chain);                           // the next wall's angle is measured from this one
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
            setSlide(null);
        setEndDrag(null);
            return;
        }
        // mouse: right / middle button = pan only (never a click); left button never pans
        const isMouse = event.pointerType === 'mouse';
        if (isMouse && event.button !== 0) {
            gestureRef.current = { kind: 'pan', wallId: null, start: point, moved: true, pans: true };
            setIsPanning(true);
            return;
        }
        const dataset = event.target.dataset ?? {};
        // floor tool: the selected floor's vertex handle (data-floor-vertex) starts a vertex drag
        if (isFloorTool && dataset.floorVertex != null) {
            gestureRef.current = { kind: 'floorVertex', floorId: selectedFloorId, index: Number(dataset.floorVertex) };
            return;
        }
        // ruler: only measure labels are picked (corners, walls and openings are snap targets)
        const { vertex, wallId, openingId, measureId, measureEnd, detected } = isDrawing || underlayTool ? {} : isRuler ? { measureId: dataset.measureId, measureEnd: dataset.measureEnd } : dataset;
        // left mouse in the select tool: a drag draws a selection box; touch / pen: a drag pans
        const wall = openingId ? level.walls.find((item) => item.id === wallId) : null;
        const opening = wall?.openings.find((item) => item.id === openingId);
        gestureRef.current = measureEnd
            ? { kind: 'measureEnd', id: measureId, which: measureEnd, start: point, moved: false }
            : vertex != null
            ? { kind: 'vertex', from: levelVertices(level)[Number(vertex)] }
            : opening
            // grab: where along the wall the opening was taken, relative to its center (it slides, no jump)
            ? { kind: 'opening', wallId, openingId, start: point, moved: false, grab: alongWall(wall, toWorld(view, size.w, size.h, point.x, point.y)) - opening.offset }
            : { kind: 'pan', wallId: wallId ?? null, openingId: openingId ?? null, measureId: measureId ?? null, detected: detected ?? null, start: point, moved: false, pans: !isMouse, boxes: isMouse && !isDrawing && !isRuler && !underlayTool, shift: event.shiftKey };
    };

    // One pointer: corner drag or pan. Two pointers: zoom by the change of their distance, at their
    // midpoint, plus pan by the midpoint's movement.
    const onPointerMove = (event) => {
        const pointers = pointersRef.current;
        const previous = pointers.get(event.pointerId);
        if (size == null || view == null) return;
        const point = localPoint(event);
        const dragged = gestureRef.current?.kind === 'floorVertex' ? gestureRef.current.floorId : null; // not its own snap target
        if (isTraceTool && pointers.size <= 1) setTraceHover(traceAt(point));
        else if (isOpeningTool && pointers.size <= 1) setOpeningHover(openingAt(point));
        else if (isDrawing && pointers.size <= 1) setHover(isFloorTool ? floorSnap(point, dragged) : snapPoint(point)); // preview of the next point (mouse)
        if (isRuler && pointers.size <= 1) setRulerHover(rulerPoint(point, event.shiftKey));
        if (underlayTool && pointers.size <= 1) setToolHover(underlayToolPoint(point, event.shiftKey));
        if (previous == null) return;
        const gesture = gestureRef.current;
        if (pointers.size === 1 && gesture?.kind === 'floorVertex') {
            const { point: to, guides } = floorSnap(point, gesture.floorId);
            const next = moveFloorVertex(level, gesture.floorId, gesture.index, to);
            if (next) setDraft({ level: next, point: to, guides, isFloor: true }); // invalid (edges crossing): keep the last valid one
        } else if (pointers.size === 1 && gesture?.kind === 'vertex') {
            // align with the other corners (never with the dragged one's own start position)
            const targets = levelVertices(level).filter((v) => v[0] !== gesture.from[0] || v[1] !== gesture.from[1]);
            // a DXF underlay's end point / line wins (moving a corner onto the drawing)
            const cad = cadSnap(point);
            const { point: to, guides } = cad ? { point: cad.point, guides: [] } : alignPoint(snappedWorld(point), targets, ALIGN_SNAP_RADIUS / view.scale);
            const next = moveVertex(level, gesture.from, to);
            if (next) setDraft({ level: next, point: to, guides }); // invalid: keep the last valid one
        } else if (pointers.size === 1 && gesture?.kind === 'measureEnd') {
            if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > CLICK_SLOP) gesture.moved = true;
            const item = gesture.moved && measureList.find((entry) => entry.id === gesture.id);
            if (item) {
                // locked to the axis through the OTHER end (Shift = free); this measure is not a snap target
                const hit = rulerPoint(point, event.shiftKey, gesture.which === 'a' ? item.b : item.a, gesture.id);
                setEndDrag({ id: gesture.id, which: gesture.which, ...hit });
            }
        } else if (pointers.size === 1 && gesture?.kind === 'opening') {
            if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > CLICK_SLOP) gesture.moved = true;
            if (gesture.moved) {
                const wall = level.walls.find((item) => item.id === gesture.wallId);
                const opening = wall?.openings.find((item) => item.id === gesture.openingId);
                if (opening) {
                    const { length } = wallFrame(wall);
                    let from = alongWall(wall, toWorld(view, size.w, size.h, point.x, point.y)) - gesture.grab - opening.width / 2;
                    const { gridSnap, gridSnapStep } = useStore.getState().settings;
                    if (gridSnap) from = Math.round(from / (gridSnapStep / 100)) * (gridSnapStep / 100);
                    from = Math.min(Math.max(from, 0), length - opening.width); // stops at the wall's ends
                    const next = updateOpening(level, gesture.wallId, gesture.openingId, { offset: from + opening.width / 2 });
                    if (next) setSlide({ level: next, wallId: gesture.wallId, openingId: gesture.openingId }); // overlap: keep the last valid
                }
            }
        } else if (pointers.size === 1) {
            if (gesture && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > CLICK_SLOP) gesture.moved = true;
            if (gesture?.pans) setView((current) => current && panBy(current, point.x - previous.x, point.y - previous.y));
            if (gesture?.boxes && gesture.moved) setBox({ start: gesture.start, end: point });
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
        if ((gesture.kind === 'vertex' || gesture.kind === 'floorVertex') && draft) setActiveLevel(draft.level);
        if (gesture.kind === 'measureEnd' && endDrag) {
            const item = measureList.find((entry) => entry.id === endDrag.id);
            const y = endDrag.which === 'a' ? item.ya : item.yb; // the end keeps its height
            useStore.getState().moveMeasureEnd(endDrag.id, endDrag.which, { p: [endDrag.point[0], y, endDrag.point[1]] });
        }
        if (gesture.kind === 'opening') {
            if (gesture.moved && slide) setActiveLevel(slide.level);
            useStore.getState().setSelectedOpening({ wallId: gesture.wallId, openingId: gesture.openingId });
        }
        if (gesture.kind === 'pan' && gesture.boxes && gesture.moved && box) {
            // box released: window (dragged right) or crossing (dragged left); Shift adds
            const corner1 = toWorld(view, size.w, size.h, box.start.x, box.start.y);
            const corner2 = toWorld(view, size.w, size.h, box.end.x, box.end.y);
            const ids = wallsInBox(level.walls, corner1, corner2, box.end.x < box.start.x);
            const { selectedWallIds: current, setSelectedWallIds } = useStore.getState();
            setSelectedWallIds(gesture.shift ? [...new Set([...current, ...ids])] : ids);
        } else if (gesture.kind === 'pan' && !gesture.moved) {
            const { measures: current, selectMeasure } = useStore.getState();
            if (underlayTool) placeUnderlayPoint(underlayToolPoint(localPoint(event), event.shiftKey));
            else if (gesture.measureId) selectMeasure(current.selectedId === gesture.measureId ? null : gesture.measureId);
            else if (isRuler) placeRulerPoint(rulerPoint(localPoint(event), event.shiftKey));
            else if (isTraceTool) {
                const traced = traceAt(localPoint(event), newWallId());
                if (traced) setActiveLevel(traced.level);
                setTraceHover(null);
            }
            else if (isOpeningTool) {
                const placed = openingAt(localPoint(event), newOpeningId());
                if (placed) useStore.getState().setActiveLevelRemoving(placed.level, placed.removedWallId ? [placed.removedWallId] : []);
                setOpeningHover(null);
            }
            else if (isFloorTool) placeFloorPoint(floorSnap(localPoint(event)));
            else if (isDrawing) placePoint(snapPoint(localPoint(event)));
            else if (gesture.detected != null) useStore.getState().toggleDetectedWall(Number(gesture.detected)); // automatic walls preview
            else if (gesture.shift && gesture.wallId) useStore.getState().toggleSelectedWall(gesture.wallId);
            else setSelectedWallId(gesture.wallId);
        }
        gestureRef.current = null;
        setDraft(null);
        setSlide(null);
        setEndDrag(null);
        setBox(null);
        setIsPanning(false);
    };

    // Lost pointer (system gesture, capture lost): drop the gesture, never save a half drag
    const onPointerCancel = (event) => {
        pointersRef.current.delete(event.pointerId);
        gestureRef.current = null;
        setDraft(null);
        setSlide(null);
        setEndDrag(null);
        setBox(null);
        setIsPanning(false);
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
            style={{ '--wall-opacity': wallOpacity }}
            className={`plan-view${isDrawing ? ' is-drawing' : ''}${isRuler || underlayTool ? ' is-measuring' : ''}${isPanning ? ' is-panning' : ''}`}
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
                    {/* floor plan underlay (planModel.js level.underlay), under everything; this device's visibility / opacity */}
                    {underlay && isUnderlayVisible && (underlay.kind === 'dxf'
                        ? <UnderlayVectors underlay={underlay} opacity={underlayOpacity} />
                        : <UnderlayImage underlay={underlay} opacity={underlayOpacity} />)}
                    {/* automatic walls found on the DXF (UnderlayPanel "Detect walls"): preview, over the drawing */}
                    {underlay?.kind === 'dxf' && <DetectedWalls underlay={underlay} pickable={!isDrawing && !isRuler && !underlayTool} />}
                    <path className="plan-grid-minor" d={gridPath(view, size.w, size.h, steps.minor)} vectorEffect="non-scaling-stroke" />
                    <path className="plan-grid-major" d={gridPath(view, size.w, size.h, steps.major)} vectorEffect="non-scaling-stroke" />

                    {shown.floors.map((floor) => (
                        <polygon key={floor.id} className={isFloorTool && floor.id === selectedFloorId ? 'plan-floor is-selected' : 'plan-floor'} points={floor.points.join(' ')} vectorEffect="non-scaling-stroke" />
                    ))}

                    {shown.walls.map((wall) => {
                        // inner line a -> b, then back along the mitered outer line
                        const { a, b, bOut, aOut } = wallFootprint(wall, shown.walls);
                        return (
                            <polygon
                                key={wall.id}
                                data-wall-id={wall.id}
                                className={wall.id === 'preview' ? 'plan-wall-preview' : selectedWallIds.includes(wall.id) && !isDrawing ? 'plan-wall is-selected' : 'plan-wall'}
                                points={[a, b, bOut, aOut].join(' ')}
                                vectorEffect="non-scaling-stroke"
                            />
                        );
                    })}

                    {/* doors / windows: over their wall (a click on them selects the opening, not the wall) */}
                    {shown.walls.flatMap((wall) => openingRects(wall, wall.height ?? shown.wallHeight).map((rect) => (
                        <OpeningSymbol key={rect.opening.id} wall={wall} rect={rect} isSelected={rect.opening.id === 'preview' || (rect.opening.id === selectedOpeningId && !isDrawing)} />
                    )))}

                    {/* corner handles: invisible touch-size hit circle + visible dot (radii in px -> meters) */}
                    {levelVertices(shown).map((vertex, index) => (
                        <g key={index}>
                            <circle className="plan-vertex-hit" data-vertex={index} cx={vertex[0]} cy={vertex[1]} r={VERTEX_HIT_RADIUS / view.scale} />
                            <circle className="plan-vertex" cx={vertex[0]} cy={vertex[1]} r={VERTEX_RADIUS / view.scale} vectorEffect="non-scaling-stroke" />
                        </g>
                    ))}

                    {/* wall tool: the wall being drawn (dashed, default thickness) and the snapped point */}
                    {isDrawing && chain && hover && previewWall(shown, chain, hover.point, wallJustify)}
                    {isDrawing && chain && <circle className="plan-chain-start" cx={chain[0]} cy={chain[1]} r={VERTEX_RADIUS / view.scale} vectorEffect="non-scaling-stroke" />}
                    {/* trace tool: the face of the drawing the wall was measured on */}
                    {isTraceTool && traceHover && (
                        <line className="plan-trace-face" {...lineAt(...traceHover.trace.face)} vectorEffect="non-scaling-stroke" />
                    )}
                    {/* floor tool: vertex handles of the selected floor (not while a polygon is being drawn) */}
                    {isFloorTool && floorPoints.length === 0 && shown.floors.find((floor) => floor.id === selectedFloorId)?.points.map((p, index) => (
                        <g key={`fv${index}`}>
                            <circle className="plan-floor-handle-hit" data-floor-vertex={index} cx={p[0]} cy={p[1]} r={VERTEX_HIT_RADIUS / view.scale} />
                            <circle className="plan-vertex" cx={p[0]} cy={p[1]} r={VERTEX_RADIUS / view.scale} vectorEffect="non-scaling-stroke" />
                        </g>
                    ))}
                    {/* floor tool: the polygon being drawn, closed through the pointer (red when addFloor refuses it) */}
                    {isFloorTool && floorPoints.length > 0 && (() => {
                        const points = hover ? [...floorPoints, hover.point] : floorPoints;
                        const isInvalid = points.length >= 3 && addFloor(shown, points, 'preview') == null;
                        return (
                            <>
                                <polygon className={isInvalid ? 'plan-floor-preview is-invalid' : 'plan-floor-preview'} points={points.join(' ')} vectorEffect="non-scaling-stroke" />
                                {floorPoints.map((p, index) => (
                                    <circle key={index} className={index === 0 ? 'plan-chain-start' : 'plan-floor-point'} cx={p[0]} cy={p[1]} r={(index === 0 ? VERTEX_RADIUS : VERTEX_RADIUS / 2) / view.scale} vectorEffect="non-scaling-stroke" />
                                ))}
                            </>
                        );
                    })()}
                    {/* alignment guides: dashed lines from the corner the point lines up with */}
                    {(draft?.guides ?? (isDrawing ? hover?.guides : null) ?? []).map((guide, index) => (
                        <line key={index} className="plan-guide" x1={guide.from[0]} y1={guide.from[1]} x2={guide.to[0]} y2={guide.to[1]} vectorEffect="non-scaling-stroke" />
                    ))}
                    {isDrawing && hover?.kind === 'vertex' && (
                        <circle className="plan-snap-ring" cx={hover.point[0]} cy={hover.point[1]} r={VERTEX_SNAP_RADIUS / view.scale} vectorEffect="non-scaling-stroke" />
                    )}
                    {/* on the DXF: end point (green) or line (yellow), like the ruler's snap marks */}
                    {isDrawing && hover?.kind === 'cad' && (
                        <circle className={`plan-cad-snap is-${hover.cadKind}`} cx={hover.point[0]} cy={hover.point[1]} r={CAD_SNAP_MARK / view.scale} vectorEffect="non-scaling-stroke" />
                    )}
                </g>
            )}

            {/* measures (3D ruler's, seen from above) + ruler preview: screen space, constant size */}
            {isReady && (
                <PlanMeasures view={view} size={size} list={shownMeasures} selectedId={measures.selectedId} editableId={editableId}
                    preview={endDrag ? { point: endDrag.point, kind: endDrag.kind, start: null } : isRuler && rulerHover ? {
                        ...rulerHover,
                        start: measures.start ? [measures.start.p[0], measures.start.p[2]] : null,
                        length: measures.start ? Math.hypot(rulerHover.point[0] - measures.start.p[0], rulerHover.point[1] - measures.start.p[2]) : 0 // same height
                    } : null} />
            )}

            {/* selection box: window (solid, dragged right) or crossing (dashed, dragged left) */}
            {box && (
                <rect
                    className={box.end.x < box.start.x ? 'plan-box is-crossing' : 'plan-box'}
                    x={Math.min(box.start.x, box.end.x)} y={Math.min(box.start.y, box.end.y)}
                    width={Math.abs(box.end.x - box.start.x)} height={Math.abs(box.end.y - box.start.y)}
                />
            )}

            {/* wall tool: live length and angle of the wall being drawn */}
            {isReady && isDrawing && chain && hover && lengthLabel(view, size, { a: chain, b: hover.point })}
            {isReady && isTraceTool && traceHover && lengthLabel(view, size, traceHover.level.walls.find((wall) => wall.id === 'preview'), ` · ${Math.round(traceHover.trace.thickness * 100)} cm`)}
            {isReady && isFloorTool && floorPoints.length > 0 && hover && lengthLabel(view, size, { a: floorPoints[floorPoints.length - 1], b: hover.point })}
            {isReady && isDrawing && chain && hover && (chainPrev
                ? angleIndicator(view, size, chain, chainPrev, hover.point, 180)                    // between walls
                : angleIndicator(view, size, chain, [chain[0] + 1, chain[1]], hover.point, 0))}     // from the horizontal
            {/* opening dragged (or selected): clear distances to the nearest opening / wall end on each side */}
            {isReady && slide && openingDistances(view, size, slide.level, slide.wallId, slide.openingId)}
            {isReady && !slide && selectedOpening && !isDrawing && openingDistances(view, size, level, selectedOpening.wallId, selectedOpening.openingId)}
            {/* corner drag: angle between the dragged corner's two walls */}
            {isReady && draft && !draft.isFloor && cornerAngle(view, size, draft)}

            {/* length labels (screen space, constant size): the selected wall, and the walls of the dragged corner */}
            {isReady && shown.walls
                .filter((wall) => selectedWallIds.includes(wall.id) || (draft && !draft.isFloor && (samePoint(wall.a, draft.point) || samePoint(wall.b, draft.point))))
                .map((wall) => lengthLabel(view, size, wall))}

        </svg>
        {isReady && !endDrag && !underlayTool && <PlanMeasureActions view={view} size={size} list={measureList} />}
        {/* underlay tool: points, live line, snapped target; calibration length field */}
        {isReady && underlayTool && (
            <UnderlayToolOverlay view={view} size={size} points={toolPoints} hover={lengthAsk ? null : toolHover} />
        )}
        {isReady && lengthAsk && <CalibrationField view={view} size={size} ask={lengthAsk} onApply={applyCalibration} />}
        {selectedWallId && !isDrawing && !draft && !slide && isReady && (
            <FlipButton view={view} size={size} wall={level.walls.find((wall) => wall.id === selectedWallId)} />
        )}
        </>
    );
}

/*
* A door / window in the 2D plan (world meters, inside the view's transform): the gap through the wall
* (hit target, data-wall-id + data-opening-id) and its drafting symbol, one per leaf (planModel.openingLeaves:
* 1..4 equal leaves, each with its fixed side towards the opening's start or end):
* - 'swing' (default): each leaf open square to the wall from its hinge, on the face it opens towards
*   (opening.swing: inner side = -normal, outer = +normal), with its swing arc;
* - 'slide' (sliding outside the wall): thin leaf panels just off the face on the swing side, on two
*   alternating tracks, each with an arrow towards the side it slides to;
* - 'pocket' (sliding into the wall): thin leaf panels on the wall's axis and the dashed pocket in the wall
*   beside the opening on each side the leaves slide to (as long as those leaves), with arrows.
* - 'standard' (windows' default): no leaves, just the window marks below.
* Windows also keep their mark across the wall at mid width (WINDOW_MARK_LENGTH, sticks out of the wall) and,
* when standard or hinged, the line on the wall's axis.
*/
function OpeningSymbol({ wall, rect, isSelected }) {
    const { dir, normal } = wallFrame(wall);
    const { inner, outer } = faceOffsets(wall);
    const at = (t, offset) => [wall.a[0] + dir[0] * t + normal[0] * offset, wall.a[1] + dir[1] * t + normal[1] * offset];
    const { from, to, opening } = rect;
    const gap = [at(from, inner), at(to, inner), at(to, outer), at(from, outer)];
    const operation = openingOperation(opening);
    const leaves = openingLeaves(opening, from, to);
    const isOut = opening.swing === 'out';
    const side = isOut ? 1 : -1;                      // away from the wall, along the normal, on the swing side
    const face = isOut ? Math.max(inner, outer) : Math.min(inner, outer);
    const axis = (inner + outer) / 2;
    const isWindow = opening.type === 'window';
    const panel = (leaf, near, far, key) => (
        <polygon key={key} className="plan-opening-leaf" points={[at(leaf.from, near), at(leaf.to, near), at(leaf.to, far), at(leaf.from, far)].join(' ')} vectorEffect="non-scaling-stroke" />
    );
    // arrow along the wall from the leaf's middle towards the side it slides to, at offset `offset`
    const arrow = (leaf, offset, key) => {
        const width = leaf.to - leaf.from;
        const tail = (leaf.from + leaf.to) / 2;
        const tip = tail + (leaf.towardsStart ? -1 : 1) * width * 0.35;
        const head = Math.min(ARROW_HEAD, width * 0.15) * (leaf.towardsStart ? 1 : -1);
        const [p, q, h1, h2] = [at(tail, offset), at(tip, offset), at(tip + head, offset + Math.abs(head) * 0.6), at(tip + head, offset - Math.abs(head) * 0.6)];
        return <path key={key} className="plan-opening-mark" d={`M${p}L${q}M${h1}L${q}L${h2}`} vectorEffect="non-scaling-stroke" />;
    };

    let symbol;
    if (operation === 'slide') {
        symbol = leaves.flatMap((leaf, i) => {
            const near = face + side * (SLIDE_GAP + (i % 2) * LEAF_THICKNESS);
            return [panel(leaf, near, near + side * LEAF_THICKNESS, `leaf${i}`), arrow(leaf, near + side * (LEAF_THICKNESS + SLIDE_GAP * 2), `arrow${i}`)];
        });
    } else if (operation === 'pocket') {
        // leaves on two tracks around the axis; pockets: as long as the leaves sliding to each side
        const half = Math.min(LEAF_THICKNESS, Math.abs(outer - inner) / 4);
        const towardsStart = leaves.filter((leaf) => leaf.towardsStart).reduce((sum, leaf) => sum + leaf.to - leaf.from, 0);
        const towardsEnd = (to - from) - towardsStart;
        const pocket = (t0, t1, key) => (
            <polygon key={key} className="plan-opening-swing" points={[at(t0, axis - half), at(t1, axis - half), at(t1, axis + half), at(t0, axis + half)].join(' ')} vectorEffect="non-scaling-stroke" />
        );
        symbol = [
            towardsStart > 0 && pocket(from - towardsStart, from, 'pocketStart'),
            towardsEnd > 0 && pocket(to, to + towardsEnd, 'pocketEnd'),
            ...leaves.flatMap((leaf, i) => {
                const near = i % 2 === 0 ? axis - half : axis;
                return [panel(leaf, near, near + half, `leaf${i}`), arrow(leaf, axis + side * (Math.abs(outer - inner) / 2 + SLIDE_GAP * 2), `arrow${i}`)];
            })
        ];
    } else if (operation === 'swing') {
        symbol = leaves.flatMap((leaf, i) => {
            const width = leaf.to - leaf.from;
            const [hingeT, freeT] = leaf.towardsStart ? [leaf.from, leaf.to] : [leaf.to, leaf.from];
            const hinge = at(hingeT, face);
            const tip = [hinge[0] + normal[0] * side * width, hinge[1] + normal[1] * side * width];
            const closed = at(freeT, face);
            // arc direction: clockwise on screen when leaf -> closed turns positively (screen y = world z down)
            const sweep = (tip[0] - hinge[0]) * (closed[1] - hinge[1]) - (tip[1] - hinge[1]) * (closed[0] - hinge[0]) > 0 ? 1 : 0;
            return [
                <line key={`leaf${i}`} className="plan-opening-mark" x1={hinge[0]} y1={hinge[1]} x2={tip[0]} y2={tip[1]} vectorEffect="non-scaling-stroke" />,
                // quarter circle from the open leaf's tip back to the closed position
                <path key={`arc${i}`} className="plan-opening-swing" d={`M${tip[0]} ${tip[1]}A${width} ${width} 0 0 ${sweep} ${closed[0]} ${closed[1]}`} vectorEffect="non-scaling-stroke" />
            ];
        });
    }

    return (
        <g className={isSelected ? 'plan-opening is-selected' : 'plan-opening'}>
            <polygon className="plan-opening-gap" data-wall-id={wall.id} data-opening-id={opening.id} points={gap.join(' ')} vectorEffect="non-scaling-stroke" />
            {isWindow && (operation === 'swing' || operation === 'standard') && <line className="plan-opening-mark" {...lineAt(at(from, axis), at(to, axis))} vectorEffect="non-scaling-stroke" />}
            {isWindow && <line className="plan-opening-mark" {...lineAt(at((from + to) / 2, axis - WINDOW_MARK_LENGTH / 2), at((from + to) / 2, axis + WINDOW_MARK_LENGTH / 2))} vectorEffect="non-scaling-stroke" />}
            {symbol}
        </g>
    );
}

// Distance of world point p from the wall's start along its line (meters)
const alongWall = (wall, p) => {
    const { dir } = wallFrame(wall);
    return (p[0] - wall.a[0]) * dir[0] + (p[1] - wall.a[1]) * dir[1];
};

/*
* Clear distances of an opening (dragged or selected) along its wall: from its edges to the NEAREST element
* on each side, i.e. the next opening of the same wall or, if none, the visible end of the wall's inner
* face (mitered footprint: at a corner, the face of the other wall). Two length labels (inside the room).
*/
function openingDistances(view, size, level, wallId, openingId) {
    const wall = level.walls.find((item) => item.id === wallId);
    const opening = wall?.openings?.find((item) => item.id === openingId);
    if (opening == null) return null;
    const { dir } = wallFrame(wall);
    const footprint = wallFootprint(wall, level.walls);
    const at = (t) => [wall.a[0] + dir[0] * t, wall.a[1] + dir[1] * t];
    const from = opening.offset - opening.width / 2, to = opening.offset + opening.width / 2;
    const others = wall.openings.filter((item) => item.id !== openingId);
    const before = Math.max(alongWall(wall, footprint.a), ...others.map((o) => o.offset + o.width / 2).filter((t) => t <= from + 1e-9));
    const after = Math.min(alongWall(wall, footprint.b), ...others.map((o) => o.offset - o.width / 2).filter((t) => t >= to - 1e-9));
    return [
        from - before > 0.005 && lengthLabel(view, size, { id: 'gap-before', a: at(before), b: at(from) }),
        after - to > 0.005 && lengthLabel(view, size, { id: 'gap-after', a: at(to), b: at(after) })
    ];
}

const lineAt = (p, q) => ({ x1: p[0], y1: p[1], x2: q[0], y2: q[1] });

// Underlay tool marks (screen space, constant size): placed points, the line to the pointer, the hovered point
function UnderlayToolOverlay({ view, size, points, hover }) {
    const screen = (p) => toScreen(view, size.w, size.h, p[0], p[1]);
    const ends = hover ? [...points, hover.point] : points;
    const shown = ends.map(screen);
    return (
        <svg className="plan-underlay-tool">
            {shown.length === 2 && <line x1={shown[0][0]} y1={shown[0][1]} x2={shown[1][0]} y2={shown[1][1]} />}
            {shown.map(([x, y], index) => (
                <circle key={index} cx={x} cy={y} r={hover?.kind === 'vertex' && index === shown.length - 1 ? 7 : 4.5} />
            ))}
        </svg>
    );
}

// Real length of the calibration segment: a small field at its middle (Enter applies, Esc cancels)
function CalibrationField({ view, size, ask, onApply }) {
    const [x, y] = toScreen(view, size.w, size.h, (ask.a[0] + ask.b[0]) / 2, (ask.a[1] + ask.b[1]) / 2);
    return (
        <div className="plan-calibration" style={{ left: x, top: y }} onPointerDown={(event) => event.stopPropagation()}>
            <span>Real length</span>
            <input
                autoFocus
                type="text"
                inputMode="decimal"
                placeholder="m"
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !onApply(event.target.value)) event.target.select();
                    if (event.key === 'Escape') { event.stopPropagation(); useStore.getState().setUnderlayTool(null); }
                }}
            />
            <span>m</span>
        </div>
    );
}

/*
* The underlay image in plan meters: width x height pixels x metersPerPixel, its center on underlay.center,
* turned by underlay.rotation (radians, plan axes: x right, z down, so positive = clockwise on screen).
* Not interactive (the plan's gestures go through it).
*/
function UnderlayImage({ underlay, opacity }) {
    const w = underlay.width * underlay.metersPerPixel;
    const h = underlay.height * underlay.metersPerPixel;
    const [cx, cz] = underlay.center;
    return (
        <image
            href={underlay.url}
            x={cx - w / 2} y={cz - h / 2} width={w} height={h}
            transform={`rotate(${underlay.rotation * 180 / Math.PI} ${cx} ${cz})`}
            preserveAspectRatio="none"
            opacity={opacity}
            pointerEvents="none"
        />
    );
}

// Snap targets of a DXF underlay shown on this device (planView.underlayTargets), NO_TARGETS otherwise
function useCadTargets(underlay, isVisible) {
    const layers = useUnderlayVectors(underlay);
    return useMemo(
        () => (isVisible && underlay?.kind === 'dxf' && layers ? underlayTargets(underlay, layers) : NO_TARGETS),
        [isVisible, underlay, layers]
    );
}

/*
* A DXF underlay (kind 'dxf'): its line segments (drawing units, centered) drawn with the same placement as
* an image: scaled by metersPerPixel (meters per unit), turned and moved onto underlay.center. One path per
* visible layer (hiddenLayers off), hairline strokes at any zoom. Nothing until the JSON is loaded.
*/
function UnderlayVectors({ underlay, opacity }) {
    const layers = useUnderlayVectors(underlay);
    const paths = useMemo(() => (layers ?? []).map(({ name, segments }) => {
        let d = '';
        for (let i = 0; i < segments.length; i += 4) d += `M${segments[i]} ${segments[i + 1]}L${segments[i + 2]} ${segments[i + 3]}`;
        return { name, d };
    }), [layers]);
    const hidden = new Set(underlay.hiddenLayers ?? []);
    const [cx, cz] = underlay.center;
    return (
        <g
            className="plan-underlay-dxf"
            transform={`translate(${cx} ${cz}) rotate(${underlay.rotation * 180 / Math.PI}) scale(${underlay.metersPerPixel})`}
            opacity={opacity}
        >
            {paths.map(({ name, d }) => !hidden.has(name) && <path key={name} d={d} vectorEffect="non-scaling-stroke" />)}
        </g>
    );
}

/*
* Preview of the automatic walls (store wallDetection, plan/dxfWalls.js) of this DXF underlay, exactly as
* "Add walls" will build them: placed in plan meters (placeDetectedWalls) and drawn with the plan model's
* footprints (detectedWallShapes: mitered corners, T joints on faces). Walls green, doors blue, windows violet.
* A click on a wall leaves it out (store excluded, red dashed; the click is handled by the plan view's gesture
* code through data-detected) or takes it back; the kept walls are joined among themselves only.
* `pickable`: clicks reach the walls (not while a tool owns the clicks).
*/
function DetectedWalls({ underlay, pickable }) {
    const detection = useStore((state) => (state.wallDetection?.url === underlay.url ? state.wallDetection : null));
    const shapes = useMemo(() => {
        if (detection == null) return [];
        const placed = placeDetectedWalls(detection.walls, underlay, (index) => `detected-${index}`);
        const kept = placed.filter((_, index) => !detection.excluded.includes(index));
        const keptShapes = detectedWallShapes(kept);
        const allShapes = detectedWallShapes(placed); // left-out walls: their shape among all the walls
        return placed.map((wall, index) => (detection.excluded.includes(index)
            ? { ...allShapes[index], excluded: true }
            : keptShapes[kept.indexOf(wall)]));
    }, [detection, underlay]);
    if (detection == null) return null;
    return (
        <g className={`plan-detected-walls${pickable ? ' is-pickable' : ''}`}>
            {shapes.map(({ wall, openings, excluded }, index) => (
                <g key={index} className={excluded ? 'is-excluded' : undefined}>
                    <polygon points={wall.join(' ')} data-detected={index} vectorEffect="non-scaling-stroke" />
                    {!excluded && openings.map((opening, i) => (
                        <polygon key={i} className={`is-${opening.type}`} points={opening.points.join(' ')} data-detected={index} vectorEffect="non-scaling-stroke" />
                    ))}
                </g>
            ))}
        </g>
    );
}

// Same corner (exact: the dragged point is copied into the walls by moveVertex)
const samePoint = (p, q) => p[0] === q[0] && p[1] === q[1];

// Length label of a wall-like { a, b } (screen space, constant size), offset inside the room
// (opposite to the outward normal; screen y = world z). Null for a zero-length segment.
function lengthLabel(view, size, wall, suffix = '') {
    if (wall.a[0] === wall.b[0] && wall.a[1] === wall.b[1]) return null;
    const { normal, length } = wallFrame(wall);
    const [mx, my] = toScreen(view, size.w, size.h, (wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2);
    return (
        <text key={wall.id ?? 'preview'} className="plan-length" x={mx - normal[0] * LABEL_OFFSET} y={my - normal[1] * LABEL_OFFSET}>
            {`${length.toFixed(2)} m${suffix}`}
        </text>
    );
}

// Footprint of the wall the tool would add from `a` to `b` (joins included), dashed; null if too short
function previewWall(level, a, b, justify) {
    const next = addWall(level, a, b, 'preview', justify);
    if (next == null) return null;
    const wall = next.walls[next.walls.length - 1];
    const { a: inA, b: inB, bOut, aOut } = wallFootprint(wall, next.walls);
    return <polygon className="plan-wall-preview" points={[inA, inB, bOut, aOut].join(' ')} vectorEffect="non-scaling-stroke" />;
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

/*
* Angle indicator at `center` (screen space): an arc between the rays center -> p and center -> q, with the
* angle value (smaller angle, degrees). Hidden when the angle is `hiddenAt` (180 = straight continuation,
* 0 = horizontal first wall) within half a degree, or when a ray has no length.
*/
function angleIndicator(view, size, center, p, q, hiddenAt) {
    if ((p[0] === center[0] && p[1] === center[1]) || (q[0] === center[0] && q[1] === center[1])) return null;
    const degrees = angleBetween(center, p, q);
    if (Math.abs(degrees - hiddenAt) < 0.5) return null;
    const [cx, cy] = toScreen(view, size.w, size.h, center[0], center[1]);
    const unit = (point) => {
        const [x, y] = toScreen(view, size.w, size.h, point[0], point[1]);
        const length = Math.hypot(x - cx, y - cy);
        return [(x - cx) / length, (y - cy) / length];
    };
    const u1 = unit(p), u2 = unit(q);
    const r = ANGLE_ARC_RADIUS;
    const sweep = u1[0] * u2[1] - u1[1] * u2[0] > 0 ? 1 : 0; // clockwise on screen (y down)
    const bisector = [u1[0] + u2[0], u1[1] + u2[1]];
    const bisectorLength = Math.hypot(bisector[0], bisector[1]) || 1;
    const lx = cx + (bisector[0] / bisectorLength) * (r + 16), ly = cy + (bisector[1] / bisectorLength) * (r + 16);
    return (
        <g key="angle" pointerEvents="none">
            <path className="plan-angle-arc" d={`M${cx + u1[0] * r} ${cy + u1[1] * r}A${r} ${r} 0 0 ${sweep} ${cx + u2[0] * r} ${cy + u2[1] * r}`} />
            <text className="plan-length" x={lx} y={ly}>{`${degrees.toFixed(degrees % 1 < 0.05 || degrees % 1 > 0.95 ? 0 : 1)}°`}</text>
        </g>
    );
}

// Corner drag: the angle between the two walls meeting at the dragged corner (none if it has 1 or 3+ walls)
function cornerAngle(view, size, draft) {
    const ends = draft.level.walls
        .filter((wall) => samePoint(wall.a, draft.point) || samePoint(wall.b, draft.point))
        .map((wall) => (samePoint(wall.a, draft.point) ? wall.b : wall.a));
    return ends.length === 2 ? angleIndicator(view, size, draft.point, ends[0], ends[1], 180) : null;
}
