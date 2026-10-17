/*
* Pure helpers of the 2D plan view (PlanView2D.jsx): camera math and grid lines, no React.
*
* View: { cx, cz, scale } — world point (meters) at the center of the view, pixels per meter.
* Screen axes: world X -> right, world Z -> down (top view looking down -Y, north = -Z up).
*/
export const MIN_SCALE = 5;     // px per meter: whole building
export const MAX_SCALE = 2000;  // px per meter: millimeter detail
const FIT_MARGIN = 1;           // meters of empty space around the level when fitting

const clampScale = (scale) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

// View that shows the whole of `bounds` (planModel.levelBounds) in a w x h pixel area
export function fitView(bounds, w, h) {
    const width = bounds.max[0] - bounds.min[0] + 2 * FIT_MARGIN;
    const depth = bounds.max[1] - bounds.min[1] + 2 * FIT_MARGIN;
    return { cx: bounds.center[0], cz: bounds.center[1], scale: clampScale(Math.min(w / width, h / depth)) };
}

// Screen pixel (relative to the view's top-left corner) -> world [x, z]
export function toWorld(view, w, h, px, py) {
    return [view.cx + (px - w / 2) / view.scale, view.cz + (py - h / 2) / view.scale];
}

// Zoom by `factor` keeping the world point under the screen pixel (px, py) still
export function zoomAt(view, w, h, px, py, factor) {
    const [x, z] = toWorld(view, w, h, px, py);
    const scale = clampScale(view.scale * factor);
    return { cx: x - (px - w / 2) / scale, cz: z - (py - h / 2) / scale, scale };
}

// Move the view by a screen delta in pixels (the content follows the pointer)
export function panBy(view, dx, dy) {
    return { ...view, cx: view.cx - dx / view.scale, cz: view.cz - dy / view.scale };
}

// Grid steps (meters) readable at this scale: minor lines at least ~8 px apart, major = 10 minor
export function gridSteps(scale) {
    const minor = [0.1, 0.5, 1, 5, 10].find((step) => step * scale >= 8) ?? 10;
    return { minor, major: minor * 10 };
}

// SVG path ("M x z V z2 ..." in world meters) of the grid lines with `step` inside the visible area
export function gridPath(view, w, h, step) {
    const [x0, z0] = toWorld(view, w, h, 0, 0);
    const [x1, z1] = toWorld(view, w, h, w, h);
    let d = '';
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) d += `M${x.toFixed(3)} ${z0}V${z1}`;
    for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) d += `M${x0} ${z.toFixed(3)}H${x1}`;
    return d;
}
