import { cloneElement, useContext, useEffect, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { drawPanel, useCanvasTexture } from './useCanvasTexture';
import { BUTTON_SIZE } from './layout';
import { PointerFilterContext } from './pointers';

// Label buttons default to BUTTON_SIZE; icon buttons pass a square `size`.
const PIXELS_PER_METER = 4000; // canvas resolution: crisp at arm's length, cheap to redraw

/*
* The desktop SVG logos (utils/svg-logos.jsx, React elements) as images for the canvas: white, like
* the toolbar's CircleButton (fill/color on the root, inherited by paths without their own fill).
*/
function useSvgImage(svg) {
    const [image, setImage] = useState(null);
    useEffect(() => {
        if (svg == null) return;
        const markup = renderToStaticMarkup(cloneElement(svg, { width: 256, height: 256, fill: 'white', color: 'white' }));
        const img = new Image();
        img.onload = () => setImage(img);
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    }, [svg]);
    return image;
}

/*
* Flat in-VR button. Pressed with the controller/hand ray or by poking it with the index finger
* (pmndrs pointer events from @react-three/xr). `active` highlights toggles that are on.
* Content: a desktop `svg` logo, an `icon(ctx, x, y, size)` drawing function (see objectIcons.js), or
* a text `label` (shrunk to fit the width).
*/
export default function VRButton({ label, icon, svg, size = BUTTON_SIZE, active = false, onClick, ...groupProps }) {
    const [hovered, setHovered] = useState(false);
    const acceptsPointer = useContext(PointerFilterContext); // which pointers can press it (pointers.js)
    const svgImage = useSvgImage(svg);
    const [width, height] = size;

    const texture = useCanvasTexture(Math.round(width * PIXELS_PER_METER), Math.round(height * PIXELS_PER_METER), (ctx, w, h) => {
        const fill = active ? 'rgba(255, 150, 40, 0.9)' : hovered ? 'rgba(70, 90, 190, 0.9)' : 'rgba(16, 20, 48, 0.85)';
        drawPanel(ctx, w, h, fill);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#ffffff';
        const iconSize = Math.min(w, h) * 0.62;
        if (svgImage) {
            ctx.drawImage(svgImage, (w - iconSize) / 2, (h - iconSize) / 2, iconSize, iconSize);
            return;
        }
        if (icon) {
            icon(ctx, w / 2, h / 2, iconSize);
            return;
        }
        if (svg) return; // logo still loading: redrawn when it arrives
        const font = (px) => `600 ${Math.round(px)}px "SUSE Mono", monospace`;
        const fontSize = h * (label.length > 6 ? 0.32 : 0.4);
        ctx.font = font(fontSize);
        const fit = (w * 0.85) / ctx.measureText(label).width;
        if (fit < 1) ctx.font = font(fontSize * fit);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, w / 2, h / 2 + 2);
    }, [label, icon, svg, svgImage, active, hovered]);

    return (
        <group {...groupProps}>
            <mesh
                pointerEventsType={acceptsPointer}
                onClick={(event) => { event.stopPropagation(); onClick(); }}
                onPointerEnter={() => setHovered(true)}
                onPointerLeave={() => setHovered(false)}
            >
                <planeGeometry args={[width, height]} />
                <meshBasicMaterial map={texture} transparent toneMapped={false} />
            </mesh>
        </group>
    );
}
