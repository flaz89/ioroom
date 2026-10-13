/*
* Line icons for the catalog primitives, drawn with the 2D canvas API (no image assets).
* Each icon draws centered at (x, y) inside a `size` x `size` box, using the context's current
* strokeStyle / fillStyle. Keyed by the catalog `type` (see objectsList in objectsSlice.js).
*/

function setLine(ctx, size) {
    ctx.lineWidth = Math.max(2, size * 0.07);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
}

// Isometric cube: top rhombus + two visible faces
function box(ctx, x, y, s) {
    setLine(ctx, s);
    const r = s * 0.45;
    const h = r * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y - r);                // top
    ctx.lineTo(x + r, y - r + h);
    ctx.lineTo(x + r, y + h);
    ctx.lineTo(x, y + r);                // bottom
    ctx.lineTo(x - r, y + h);
    ctx.lineTo(x - r, y - r + h);
    ctx.closePath();
    ctx.moveTo(x - r, y - r + h);        // inner edges
    ctx.lineTo(x, y);
    ctx.lineTo(x + r, y - r + h);
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + r);
    ctx.stroke();
}

// Plane seen in perspective: parallelogram
function plane(ctx, x, y, s) {
    setLine(ctx, s);
    const w = s * 0.5;
    const h = s * 0.22;
    ctx.beginPath();
    ctx.moveTo(x - w + h, y - h);
    ctx.lineTo(x + w + h * 0.2, y - h);
    ctx.lineTo(x + w - h, y + h);
    ctx.lineTo(x - w - h * 0.2, y + h);
    ctx.closePath();
    ctx.stroke();
}

// Sphere: outline + equator ellipse + highlight
function sphere(ctx, x, y, s) {
    setLine(ctx, s);
    const r = s * 0.45;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.3, 0, 0, Math.PI * 2);
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
}

// Capsule: vertical stadium shape with a ring line
function capsule(ctx, x, y, s) {
    setLine(ctx, s);
    const r = s * 0.22;
    const half = s * 0.25;
    ctx.beginPath();
    ctx.arc(x, y - half, r, Math.PI, 0);
    ctx.lineTo(x + r, y + half);
    ctx.arc(x, y + half, r, 0, Math.PI);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.35, 0, 0, Math.PI);
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
}

// Cylinder: top ellipse, sides, bottom half-ellipse
function cylinder(ctx, x, y, s) {
    setLine(ctx, s);
    const r = s * 0.32;
    const e = r * 0.35;
    const half = s * 0.3;
    ctx.beginPath();
    ctx.ellipse(x, y - half, r, e, 0, 0, Math.PI * 2);
    ctx.moveTo(x - r, y - half);
    ctx.lineTo(x - r, y + half);
    ctx.ellipse(x, y + half, r, e, 0, Math.PI, 0, true);
    ctx.lineTo(x + r, y - half);
    ctx.stroke();
}

// Circle (flat disc): filled ellipse seen from above at an angle
function circle(ctx, x, y, s) {
    setLine(ctx, s);
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.45, s * 0.25, 0, 0, Math.PI * 2);
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
}

// Donut (torus): outer and inner ellipses
function donut(ctx, x, y, s) {
    setLine(ctx, s);
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.46, s * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y - s * 0.02, s * 0.18, s * 0.08, 0, 0, Math.PI * 2);
    ctx.stroke();
}

// Torus knot: trefoil curve
function knot(ctx, x, y, s) {
    setLine(ctx, s);
    const k = s * 0.16;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
        const t = (i / 120) * Math.PI * 2;
        const px = x + k * (Math.sin(t) + 2 * Math.sin(2 * t));
        const py = y + k * (Math.cos(t) - 2 * Math.cos(2 * t));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.stroke();
}

export const objectIcons = { box, plane, sphere, capsule, cylinder, circle, donut, knot };
