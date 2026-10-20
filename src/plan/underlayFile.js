import { useEffect, useState } from 'react';
import { API_ORIGIN, adminToken } from '../sync/roomSync';
import { dxfVectors } from './dxfUnderlay';
import { pdfVectors } from './pdfUnderlay';

/*
* Floor plan UNDERLAY files (builder: a drawing traced under the plan, planModel.js "UNDERLAY").
* - prepareUnderlay(file): the chosen image or PDF (first page) as a WebP / JPEG ready to upload, with
*   what the nominal scale needs: { blob, kind, width, height, dpi, downscale }; or a DXF parsed into line
*   segments per layer (dxfUnderlay.js) as JSON: { blob, kind: 'dxf', width, height, units, layers }.
*   A VECTOR PDF (CAD export: lines and no image, or many lines) becomes the same vector data (pdfUnderlay.js),
*   kind 'dxf' with source 'pdf': in points, sized by the nominal scale (dpi 72, downscale 1) like a raster
*   PDF, plus hiddenLayers (layers off in the PDF, wall hatches). A scanned PDF (an image, maybe with a few
*   lines on top: a frame, a stamp) stays an image.
* - useUnderlayVectors(underlay): a DXF underlay's layers once its JSON is loaded (cached per URL), else null.
* - uploadUnderlay(blob): stores it in R2 (server/src/underlays.js, owner only) -> its public URL.
* - cleanUnderlayStorage(): deletes the files no environment uses (older than a day) -> { deleted, inUse, recent }.
* Errors reject with an Error whose message is meant for the UI.
*/
const MAX_SIDE = 4096;      // px: longest side of the stored image (texture size limit, memory)
const PDF_RENDER_DPI = 150; // a PDF page is drawn at this resolution (then capped to MAX_SIDE)
const QUALITY = 0.85;       // WebP / JPEG quality
const PDF_TYPE = 'application/pdf';
const SCAN_MAX_SEGMENTS = 200; // a page with an image and fewer lines than this is a scan -> rendered as an image
const HATCH_LAYER = /patt|hatch|retin|tratteg/i; // wall hatch layers: thousands of lines, hidden at first
export const UNDERLAY_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.dxf';

// A canvas as an image blob: WebP, or JPEG where the browser cannot encode WebP (it returns PNG instead)
async function canvasBlob(canvas) {
    const toBlob = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
    const webp = await toBlob('image/webp');
    return webp?.type === 'image/webp' ? webp : toBlob('image/jpeg');
}

// Scale that fits w x h within MAX_SIDE (never enlarges)
const fitScale = (w, h) => Math.min(1, MAX_SIDE / Math.max(w, h));

// First page of a PDF: its vectors when it has enough lines (a CAD export), else drawn on a canvas.
// pdf.js is loaded only here (it is large) and runs in its worker.
async function preparePdf(file) {
    // The worker file is imported as a URL (Vite "?url": emitted as an asset in the build, served in dev);
    // new URL('pdfjs-dist/…', import.meta.url) does not resolve package names, so the worker failed to load
    const [pdfjs, { default: workerUrl }] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    try {
        const page = await pdf.getPage(1);
        const vector = await pdfVectorData(pdfjs, pdf, page);
        if (vector) return vector;
        const points = page.getViewport({ scale: 1 }); // PDF units: points, 1/72 inch
        const scale = (PDF_RENDER_DPI / 72) * fitScale(points.width * PDF_RENDER_DPI / 72, points.height * PDF_RENDER_DPI / 72);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff'; // drawings have a transparent page: paper white under the lines
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport }).promise;
        // dpi 72 (points) x downscale = stored pixels per point
        const blob = await canvasBlob(canvas);
        if (blob == null) throw new Error('The image could not be prepared');
        return { blob, width: canvas.width, height: canvas.height, kind: 'pdf', dpi: 72, downscale: canvas.width / points.width };
    } finally {
        pdf.destroy();
    }
}

// A page's lines as vector underlay data, or null for a scan (no lines, or an image with few lines on it).
// A simple CAD drawing (one room: a handful of lines, no image) is still vector.
async function pdfVectorData(pdfjs, pdf, page) {
    const config = await pdf.getOptionalContentConfig();
    const ops = await page.getOperatorList();
    let vectors;
    try {
        vectors = pdfVectors(ops, pdfjs.OPS, page.getViewport({ scale: 1 }).transform, (id) => config.getGroup(id)?.name);
    } catch {
        return null; // no paths at all
    }
    const { OPS } = pdfjs;
    const hasImage = ops.fnArray.some((fn) => fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject);
    const count = vectors.layers.reduce((sum, layer) => sum + layer.segments.length / 4, 0);
    if (hasImage && count < SCAN_MAX_SEGMENTS) return null;
    // layers switched off in the PDF stay off, wall hatches too (still listed, switched on by hand)
    const off = new Set([...config].filter(([, group]) => !group.visible).map(([, group]) => group.name));
    const layers = vectors.layers.map((layer) => layer.name);
    const blob = new Blob([JSON.stringify({ layers: vectors.layers })], { type: 'application/json' });
    return {
        blob, kind: 'dxf', source: 'pdf', width: vectors.width, height: vectors.height, dpi: 72, downscale: 1,
        layers, hiddenLayers: layers.filter((name) => off.has(name) || HATCH_LAYER.test(name))
    };
}

// An image file drawn on a canvas, downscaled to MAX_SIDE. Its dpi is unknown here (the panel asks for it).
async function renderImage(file) {
    const bitmap = await createImageBitmap(file).catch(() => {
        throw new Error('This image cannot be read');
    });
    const scale = fitScale(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return { canvas, kind: 'image', dpi: null, downscale: canvas.width / bitmap.width };
}

// A DXF (CAD export, ASCII) parsed in the browser into line segments per layer, stored as JSON.
// dxf-parser is loaded only here. Binary DXF is not supported (rare: CAD programs save ASCII by default).
async function prepareDxf(file) {
    const { default: DxfParser } = await import('dxf-parser');
    let dxf;
    try {
        dxf = new DxfParser().parseSync(await file.text());
    } catch {
        throw new Error('This DXF cannot be read (save it as ASCII DXF)');
    }
    const vectors = dxfVectors(dxf);
    const blob = new Blob([JSON.stringify({ layers: vectors.layers })], { type: 'application/json' });
    return { blob, kind: 'dxf', width: vectors.width, height: vectors.height, units: vectors.units, layers: vectors.layers.map((layer) => layer.name) };
}

export async function prepareUnderlay(file) {
    if (/\.dxf$/i.test(file.name)) return prepareDxf(file);
    const isPdf = file.type === PDF_TYPE || /\.pdf$/i.test(file.name);
    if (!isPdf && !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose an image (PNG, JPEG, WebP), a PDF or a DXF');
    if (isPdf) return preparePdf(file);
    const { canvas, ...info } = await renderImage(file);
    const blob = await canvasBlob(canvas);
    if (blob == null) throw new Error('The image could not be prepared');
    return { blob, width: canvas.width, height: canvas.height, ...info };
}

export async function uploadUnderlay(blob) {
    const form = new FormData();
    form.set('file', blob);
    const response = await fetch(`${API_ORIGIN}/api/underlays`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: form });
    if (!response.ok) {
        const { error } = await response.json().catch(() => ({}));
        throw new Error(error ?? `Upload failed (${response.status})`);
    }
    const { key } = await response.json();
    return `${API_ORIGIN}/files/${key}`;
}

// "Clean storage" (My environments): unused underlay files removed by the server, owner only
export async function cleanUnderlayStorage() {
    const response = await fetch(`${API_ORIGIN}/api/underlays/cleanup`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Cleanup failed (${response.status})`);
    return body;
}

// DXF vectors by URL: one download per file per session (the 2D plan and the 3D floor share it)
const vectorCache = new Map(); // url -> Promise<layers>
function loadVectors(url) {
    if (!vectorCache.has(url)) {
        const request = fetch(url).then((response) => {
            if (!response.ok) throw new Error(`Cannot load the drawing (${response.status})`);
            return response.json();
        }).then((data) => data.layers);
        request.catch(() => vectorCache.delete(url)); // a failed download is retried next time
        vectorCache.set(url, request);
    }
    return vectorCache.get(url);
}

export function useUnderlayVectors(underlay) {
    const url = underlay?.kind === 'dxf' ? underlay.url : null;
    const [loaded, setLoaded] = useState(null); // { url, layers }
    useEffect(() => {
        if (url == null) return;
        let alive = true;
        loadVectors(url).then((layers) => alive && setLoaded({ url, layers })).catch((error) => console.warn(error));
        return () => { alive = false; };
    }, [url]);
    return loaded?.url === url ? loaded.layers : null;
}
