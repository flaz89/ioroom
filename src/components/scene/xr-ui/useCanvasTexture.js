import { useEffect, useLayoutEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';

/*
* Texture drawn with the 2D canvas API, for in-VR UI (labels, panels).
* Works on both renderers and needs no font download (unlike SDF text).
* `draw(ctx, width, height)` runs again whenever `deps` change.
*/
export function useCanvasTexture(width, height, draw, deps) {
    const texture = useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const tex = new CanvasTexture(canvas);
        tex.colorSpace = SRGBColorSpace;
        tex.anisotropy = 4; // panels are often seen at grazing angles on the wrist
        return tex;
    }, [width, height]);

    useLayoutEffect(() => {
        const canvas = texture.image;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        draw(ctx, canvas.width, canvas.height);
        // eslint-disable-next-line react-hooks/immutability -- three.js textures are mutable by design
        texture.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `draw` is recreated every render; `deps` drive redraws
    }, [texture, ...deps]);

    useEffect(() => () => texture.dispose(), [texture]);

    return texture;
}

// Shared panel background: translucent dark rounded rectangle (matches the DOM glass style)
export function drawPanel(ctx, width, height, fill = 'rgba(16, 20, 48, 0.85)', stroke = 'rgba(255, 255, 255, 0.25)') {
    const radius = Math.min(width, height) * 0.18;
    ctx.beginPath();
    ctx.roundRect(4, 4, width - 8, height - 8, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = stroke;
    ctx.stroke();
}
