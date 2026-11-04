import { cloneElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { drawPanel } from './useCanvasTexture';

// Button faces drawn on a canvas: shared by VRButton (one button per mesh) and WristBoard (a whole menu page)
export const PIXELS_PER_METER = 4000; // canvas resolution: crisp at arm's length, cheap to redraw
export const BUTTON_FILL = 'rgba(16, 20, 48, 0.85)';
export const BUTTON_ACTIVE_FILL = 'rgba(255, 150, 40, 0.9)';

/*
* The desktop SVG logos (utils/svg-logos.jsx, React elements) as images for the canvas: white, like
* the toolbar's CircleButton (fill/color on the root, inherited by paths without their own fill).
* One image per logo element, shared by every button and board that draws it.
*/
const svgImages = new Map(); // svg element -> Promise<HTMLImageElement>
export function loadSvgImage(svg) {
    if (!svgImages.has(svg)) {
        const markup = renderToStaticMarkup(cloneElement(svg, { width: 256, height: 256, fill: 'white', color: 'white' }));
        svgImages.set(svg, new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null); // a broken logo must not hold back the others (Promise.all)
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
        }));
    }
    return svgImages.get(svg);
}

/*
* Button face in the rectangle (x, y, w, h) of a canvas: panel in `fill`, then a logo image, an
* `icon(ctx, x, y, size)` drawing or a text `label` (shrunk to fit the width). Shared with WristBoard.
*/
export function drawButton(ctx, x, y, w, h, { label, icon, svgImage, fill }) {
    ctx.save();
    ctx.translate(x, y);
    drawPanel(ctx, w, h, fill);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    const iconSize = Math.min(w, h) * 0.62;
    if (svgImage) {
        ctx.drawImage(svgImage, (w - iconSize) / 2, (h - iconSize) / 2, iconSize, iconSize);
    } else if (icon) {
        icon(ctx, w / 2, h / 2, iconSize);
    } else if (label) {
        const font = (px) => `600 ${Math.round(px)}px "SUSE Mono", monospace`;
        const fontSize = h * (label.length > 6 ? 0.32 : 0.4);
        ctx.font = font(fontSize);
        const fit = (w * 0.85) / ctx.measureText(label).width;
        if (fit < 1) ctx.font = font(fontSize * fit);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, w / 2, h / 2 + 2);
    } // else: logo still loading, redrawn when it arrives
    ctx.restore();
}
