import { apply, centeredLayers, compose } from './dxfUnderlay.js';

/*
* Vector PDF -> vector UNDERLAY data, the same JSON as a DXF (dxfUnderlay.js), so snaps, Trace walls,
* Doors / Windows and Detect walls work on it unchanged. Pure function, no DOM: the page's operator list
* (pdf.js page.getOperatorList()) goes in, plain JSON comes out.
*
* pdfVectors({ fnArray, argsArray }, OPS, viewportTransform, layerName) -> { width, height, layers: [{ name, segments }] }
* - Kept: every stroked or filled path (constructPath: lines, Béziers tessellated, closed sub-paths), with
*   the current transform (cm, save / restore, form XObjects). Skipped: clipping-only paths, text, images.
* - Units: PDF points (1/72 inch), measured on the page as shown (viewportTransform: page.getViewport({ scale: 1 })
*   .transform, page rotation included); the nominal scale (1:N) turns them into meters like a raster PDF.
* - Layers: the PDF's optional content groups (CAD exports keep the CAD layers there; layerName(id) -> name);
*   without them, strokes are grouped by line width ("Lines 0.50 pt": cut walls are usually the thick lines)
*   and fills go to "Fills" (hatches, solid walls).
* - Throws when the page has no paths (a scanned plan: the caller keeps it as an image).
* ponytail: Béziers in a fixed number of steps; adaptive if arcs look faceted.
*/
const BEZIER_STEPS = 8;
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 }; // pdf.js DrawOPS

export function pdfVectors({ fnArray, argsArray }, OPS, viewportTransform, layerName = () => null) {
    const byLayer = new Map();
    let ctm = viewportTransform, lineWidth = 1;
    const saved = [];
    const content = []; // marked content stack: layer name or null
    const save = () => saved.push({ ctm, lineWidth });
    const restore = () => ({ ctm, lineWidth } = saved.pop() ?? { ctm, lineWidth });

    for (let k = 0; k < fnArray.length; k++) {
        const fn = fnArray[k], args = argsArray[k];
        switch (fn) {
            case OPS.save: save(); break;
            case OPS.restore: restore(); break;
            case OPS.transform: ctm = compose(ctm, args); break;
            case OPS.setLineWidth: lineWidth = args[0]; break;
            case OPS.paintFormXObjectBegin:
                save();
                if (args[0]) ctm = compose(ctm, args[0]);
                break;
            case OPS.paintFormXObjectEnd: restore(); break;
            case OPS.beginMarkedContent: content.push(null); break;
            case OPS.beginMarkedContentProps: {
                const props = args[1];
                const id = args[0] === 'OC' ? (props?.id ?? props?.ids?.[0]) : null;
                content.push(id != null ? (layerName(id) ?? null) : null);
                break;
            }
            case OPS.endMarkedContent: content.pop(); break;
            case OPS.constructPath: {
                const [paint, [data]] = args;
                if (paint === OPS.endPath || data == null) break; // clipping path only: not drawn
                const isFill = paint === OPS.fill || paint === OPS.eoFill;
                const group = content.findLast((name) => name != null);
                // line width as drawn on the page (the transform's mean scale)
                const width = lineWidth * Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
                const layer = group ?? (isFill ? 'Fills' : `Lines ${Math.max(width, 0.01).toFixed(2)} pt`);
                if (!byLayer.has(layer)) byLayer.set(layer, []);
                addPath(byLayer.get(layer), data, ctm, paint !== OPS.stroke);
                break;
            }
            default:
        }
    }
    return centeredLayers(byLayer, 'No lines found in this PDF');
}

// One path (pdf.js DrawOPS codes followed by their coordinates) as segments, page axes flipped to y up.
// isFilled: a fill closes every open sub-path (PDF rule), so its outline does too.
function addPath(list, data, m, isFilled) {
    let x = 0, y = 0, sx = 0, sy = 0; // current point, sub-path start (user space)
    const line = (x2, y2) => {
        const [ax, ay] = apply(m, x, y), [bx, by] = apply(m, x2, y2);
        if (ax !== bx || ay !== by) list.push(ax, -ay, bx, -by);
        x = x2; y = y2;
    };
    const closeFill = () => isFilled && line(sx, sy);
    for (let i = 0; i < data.length;) {
        switch (data[i++]) {
            case DRAW.moveTo: closeFill(); x = sx = data[i++]; y = sy = data[i++]; break;
            case DRAW.lineTo: line(data[i++], data[i++]); break;
            case DRAW.curveTo: {
                const [x0, y0, x1, y1, x2, y2, x3, y3] = [x, y, data[i], data[i + 1], data[i + 2], data[i + 3], data[i + 4], data[i + 5]];
                i += 6;
                for (let s = 1; s <= BEZIER_STEPS; s++) {
                    const t = s / BEZIER_STEPS, u = 1 - t;
                    line(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
                        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
                }
                break;
            }
            case DRAW.quadraticCurveTo: {
                const [x0, y0, x1, y1, x2, y2] = [x, y, data[i], data[i + 1], data[i + 2], data[i + 3]];
                i += 4;
                for (let s = 1; s <= BEZIER_STEPS; s++) {
                    const t = s / BEZIER_STEPS, u = 1 - t;
                    line(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
                }
                break;
            }
            case DRAW.closePath: line(sx, sy); break;
            default: return; // unknown code: the rest of the data cannot be read
        }
    }
    closeFill();
}
