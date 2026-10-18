import { API_ORIGIN, adminToken } from '../sync/roomSync';

/*
* Floor plan UNDERLAY files (builder: a drawing traced under the plan, planModel.js "UNDERLAY").
* - prepareUnderlay(file): the chosen image or PDF (first page) as a WebP / JPEG ready to upload, with
*   what the nominal scale needs: { blob, kind, width, height, dpi, downscale }.
* - uploadUnderlay(blob): stores it in R2 (server/src/underlays.js, owner only) -> its public URL.
* - cleanUnderlayStorage(): deletes the files no environment uses (older than a day) -> { kept, deleted }.
* Errors reject with an Error whose message is meant for the UI.
*/
const MAX_SIDE = 4096;      // px: longest side of the stored image (texture size limit, memory)
const PDF_RENDER_DPI = 150; // a PDF page is drawn at this resolution (then capped to MAX_SIDE)
const QUALITY = 0.85;       // WebP / JPEG quality
const PDF_TYPE = 'application/pdf';
export const UNDERLAY_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';

// A canvas as an image blob: WebP, or JPEG where the browser cannot encode WebP (it returns PNG instead)
async function canvasBlob(canvas) {
    const toBlob = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
    const webp = await toBlob('image/webp');
    return webp?.type === 'image/webp' ? webp : toBlob('image/jpeg');
}

// Scale that fits w x h within MAX_SIDE (never enlarges)
const fitScale = (w, h) => Math.min(1, MAX_SIDE / Math.max(w, h));

// First page of a PDF drawn on a canvas. pdf.js is loaded only here (it is large) and runs in its worker.
async function renderPdf(file) {
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
        return { canvas, kind: 'pdf', dpi: 72, downscale: canvas.width / points.width };
    } finally {
        pdf.destroy();
    }
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

export async function prepareUnderlay(file) {
    const isPdf = file.type === PDF_TYPE || /\.pdf$/i.test(file.name);
    if (!isPdf && !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose an image (PNG, JPEG, WebP) or a PDF');
    const { canvas, ...info } = isPdf ? await renderPdf(file) : await renderImage(file);
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
