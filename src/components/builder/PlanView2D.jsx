import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../../store/appStore';
import { activeLevel, levelBounds, wallFootprint } from '../../plan/planModel';
import { fitView, gridPath, gridSteps, panBy, zoomAt } from './planView';
import { publishCameraHeading } from '../scene/sun/cameraHeading';
import './plan-view.css';

const WHEEL_ZOOM_SPEED = 0.0015; // zoom factor per wheel delta unit (exp scale: same feel in and out)

/*
* 2D top view of the floor plan (builder mode, view '2d', store/slices/workspaceSlice.js). READ ONLY for
* now: grid in meters, floors, walls with their real thickness (mitered corners from planModel.js).
* Drawn over the 3D canvas, inside the same scene card (Scene.jsx). It reads the store `plan` only, so it
* shows remote and undo changes as they arrive.
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

    // Pointer position relative to the view
    const localPoint = (event) => {
        const rect = svgRef.current.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onPointerDown = (event) => {
        svgRef.current.setPointerCapture(event.pointerId);
        pointersRef.current.set(event.pointerId, localPoint(event));
    };

    // One pointer: pan. Two pointers: zoom by the change of their distance, at their midpoint, plus pan
    // by the midpoint's movement.
    const onPointerMove = (event) => {
        const pointers = pointersRef.current;
        const previous = pointers.get(event.pointerId);
        if (previous == null || size == null) return;
        const point = localPoint(event);
        if (pointers.size === 1) {
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

    const onPointerUp = (event) => pointersRef.current.delete(event.pointerId);

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
        <svg
            ref={svgRef}
            className="plan-view"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
        >
            {isReady && (
                // world (meters) -> screen: view center at the middle, `scale` px per meter.
                // Strokes use vector-effect="non-scaling-stroke": widths stay in pixels at any zoom.
                <g transform={`translate(${size.w / 2} ${size.h / 2}) scale(${view.scale}) translate(${-view.cx} ${-view.cz})`}>
                    <path className="plan-grid-minor" d={gridPath(view, size.w, size.h, steps.minor)} vectorEffect="non-scaling-stroke" />
                    <path className="plan-grid-major" d={gridPath(view, size.w, size.h, steps.major)} vectorEffect="non-scaling-stroke" />

                    {level.floors.map((floor) => (
                        <polygon key={floor.id} className="plan-floor" points={floor.points.join(' ')} vectorEffect="non-scaling-stroke" />
                    ))}

                    {level.walls.map((wall) => {
                        // inner line a -> b, then back along the mitered outer line
                        const { a, b, bOut, aOut } = wallFootprint(wall, level.walls);
                        return <polygon key={wall.id} className="plan-wall" points={[a, b, bOut, aOut].join(' ')} vectorEffect="non-scaling-stroke" />;
                    })}
                </g>
            )}

        </svg>
    );
}
