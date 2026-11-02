import { useContext, useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { useCanvasTexture, drawPanel } from './useCanvasTexture';
import { BUTTON_ACTIVE_FILL, BUTTON_FILL, PIXELS_PER_METER, drawButton, loadSvgImage } from './buttonFace';
import { PointerFilterContext } from './pointers';

const HOVER_FILL = 'rgba(120, 140, 255, 0.4)'; // overlay on the button under the pointer
const LAYER_GAP = 0.0005;                       // meters: hover overlay in front of the board

const _local = new Vector3();

/*
* A whole page of wrist menu buttons drawn on ONE canvas = one mesh, one draw call per eye (a mesh per
* button cost ~40 draw calls and ~2 ms per frame on the Quest 2 with the menu up).
* `buttons`: [{ id, col, row, svg | icon | label, active?, onClick }]; cell (col, row) is centered at
* (col * step[0], row * step[1]) with the size `size`. A page change = another list (one redraw).
* The canvas is redrawn only when the content changes (labels, active states, a logo arriving), never
* for hover: the button under the pointer gets a separate overlay quad, moved without React renders.
* Hit test: the hit point in the board's space -> nearest cell -> inside the button -> its onClick.
*/
export default function WristBoard({ buttons, size, step }) {
    const acceptsPointer = useContext(PointerFilterContext); // which pointers can press it (pointers.js)
    const boardRef = useRef();
    const hoverRef = useRef();
    const [w, h] = size;
    const cols = Math.max(...buttons.map((button) => button.col)) + 1;
    const rows = Math.max(...buttons.map((button) => button.row)) + 1;
    const width = (cols - 1) * step[0] + w;
    const height = (rows - 1) * step[1] + h;
    const center = [((cols - 1) * step[0]) / 2, ((rows - 1) * step[1]) / 2];

    // logos as images: all requested, the board redrawn once per arrival batch
    const [images, setImages] = useState(() => new Map());
    const svgs = buttons.map((button) => button.svg).filter(Boolean);
    const svgKey = buttons.filter((button) => button.svg).map((button) => button.id).join();
    useEffect(() => {
        let alive = true;
        Promise.all(svgs.map((svg) => loadSvgImage(svg).then((img) => [svg, img])))
            .then((entries) => { if (alive) setImages(new Map(entries)); });
        return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the logos of a page are constant elements
    }, [svgKey]);

    // content signature: redraw only when something drawn changes
    const contentKey = buttons.map((b) => `${b.id}:${b.col},${b.row}:${b.label ?? ''}:${b.active ? 1 : 0}`).join('|');
    const pixelsW = Math.round(width * PIXELS_PER_METER);
    const pixelsH = Math.round(height * PIXELS_PER_METER);
    const texture = useCanvasTexture(pixelsW, pixelsH, (ctx) => {
        const bw = w * PIXELS_PER_METER;
        const bh = h * PIXELS_PER_METER;
        for (const button of buttons) {
            // canvas y grows downwards, rows grow upwards
            const x = button.col * step[0] * PIXELS_PER_METER;
            const y = pixelsH - bh - button.row * step[1] * PIXELS_PER_METER;
            const fill = button.active ? BUTTON_ACTIVE_FILL : BUTTON_FILL;
            drawButton(ctx, x, y, bw, bh, { label: button.label, icon: button.icon, svgImage: images.get(button.svg), fill });
        }
    }, [contentKey, images, pixelsW, pixelsH]);
    const hoverTexture = useCanvasTexture(Math.round(w * PIXELS_PER_METER), Math.round(h * PIXELS_PER_METER), (ctx, cw, ch) => drawPanel(ctx, cw, ch, HOVER_FILL, 'rgba(255, 255, 255, 0.5)'), []);

    // button under a pointer event (board space), or null in the gaps
    const buttonAt = (event) => {
        boardRef.current.worldToLocal(_local.copy(event.point));
        const x = _local.x + center[0];
        const y = _local.y + center[1];
        const col = Math.round(x / step[0]);
        const row = Math.round(y / step[1]);
        if (Math.abs(x - col * step[0]) > w / 2 || Math.abs(y - row * step[1]) > h / 2) return null;
        return buttons.find((button) => button.col === col && button.row === row) ?? null;
    };
    const showHover = (button) => {
        const hover = hoverRef.current;
        hover.visible = button != null;
        if (button) hover.position.set(button.col * step[0] - center[0], button.row * step[1] - center[1], LAYER_GAP);
    };

    return (
        <group position={[center[0], center[1], 0]}>
            <mesh
                ref={boardRef}
                pointerEventsType={acceptsPointer}
                onClick={(event) => { event.stopPropagation(); buttonAt(event)?.onClick(); }}
                onPointerMove={(event) => showHover(buttonAt(event))}
                onPointerLeave={() => showHover(null)}
            >
                <planeGeometry args={[width, height]} />
                <meshBasicMaterial map={texture} transparent toneMapped={false} />
            </mesh>
            <mesh ref={hoverRef} visible={false} raycast={() => null}>
                <planeGeometry args={[w, h]} />
                <meshBasicMaterial map={hoverTexture} transparent depthWrite={false} toneMapped={false} />
            </mesh>
        </group>
    );
}
