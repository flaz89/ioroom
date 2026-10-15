/*
* Texture preparation for uploads (owner, browser side):
* - imageToWebp: downscales to fit `maxSize` and encodes WebP. Color and normal maps go up to 2K (the
*   detail you see when walking up to a wall in VR). Chrome / Firefox / Edge encode natively; browsers that cannot (Safari) use @jsquash/webp
*   (Google's libwebp compiled to WebAssembly), loaded on demand only here.
* - packOrm: packs grayscale ambient occlusion / roughness / metalness images into one ORM image
*   (R / G / B, like glTF; three.js reads aoMap.r, roughnessMap.g, metalnessMap.b), then WebP. 1K is
*   enough: AO and roughness are soft, low-frequency detail.
* Users can upload any size (2K or more recommended): only the downscaled files are uploaded.
*   Missing maps get neutral values: AO 1 (none), roughness 1 (matte), metalness 0.
* Both resolve with a WebP Blob.
*/
export const COLOR_MAX_SIZE = 2048; // color and normal maps
export const ORM_MAX_SIZE = 1024;

// 2D context of a new canvas of width × height
function createContext(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas.getContext('2d', { willReadFrequently: true });
}

// Draws `bitmap` into a new canvas of width × height; returns its 2D context
function drawToCanvas(bitmap, width, height) {
    const ctx = createContext(width, height);
    ctx.imageSmoothingQuality = 'high'; // big downscales (4K -> 2K) without aliasing
    ctx.drawImage(bitmap, 0, 0, width, height);
    return ctx;
}

// Size that fits maxSize keeping the aspect ratio (never upscaled)
function fitSize(width, height, maxSize) {
    const scale = Math.min(1, maxSize / Math.max(width, height));
    return [Math.round(width * scale), Math.round(height * scale)];
}

// Encodes a canvas context to WebP: native encoder when available, else WebAssembly
async function encodeWebp(ctx, quality) {
    const canvas = ctx.canvas;
    const native = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (native?.type === 'image/webp') return native;
    const { encode } = await import('@jsquash/webp');
    const buffer = await encode(ctx.getImageData(0, 0, canvas.width, canvas.height), { quality: Math.round(quality * 100) });
    return new Blob([buffer], { type: 'image/webp' });
}

export async function imageToWebp(file, { maxSize = COLOR_MAX_SIZE, quality = 0.85 } = {}) {
    const bitmap = await createImageBitmap(file);
    const ctx = drawToCanvas(bitmap, ...fitSize(bitmap.width, bitmap.height, maxSize));
    bitmap.close();
    return encodeWebp(ctx, quality);
}

// files: { ao?, roughness?, metalness? } (File); null when none is given
export async function packOrm(files, { maxSize = ORM_MAX_SIZE, quality = 0.9 } = {}) {
    const sources = ['ao', 'roughness', 'metalness'].map((key) => files[key] ?? null);
    if (sources.every((file) => file == null)) return null;
    const bitmaps = await Promise.all(sources.map((file) => (file ? createImageBitmap(file) : null)));
    // output size: the largest given map, fitted to maxSize; every map is resampled to it
    const largest = bitmaps.filter(Boolean).reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    const [width, height] = fitSize(largest.width, largest.height, maxSize);
    const channels = bitmaps.map((bitmap) => {
        if (!bitmap) return null;
        const data = drawToCanvas(bitmap, width, height).getImageData(0, 0, width, height).data;
        bitmap.close();
        return data;
    });
    const out = createContext(width, height);
    const image = out.createImageData(width, height);
    const defaults = [255, 255, 0]; // AO none, roughness matte, not metallic
    for (let i = 0; i < image.data.length; i += 4) {
        for (let c = 0; c < 3; c++) image.data[i + c] = channels[c] ? channels[c][i] : defaults[c]; // grayscale: red channel
        image.data[i + 3] = 255;
    }
    out.putImageData(image, 0, 0);
    return encodeWebp(out, quality);
}
