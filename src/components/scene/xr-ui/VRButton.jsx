import { useContext, useEffect, useState } from 'react';
import { useCanvasTexture } from './useCanvasTexture';
import { BUTTON_ACTIVE_FILL, BUTTON_FILL, PIXELS_PER_METER, drawButton, loadSvgImage } from './buttonFace';
import { BUTTON_SIZE } from './layout';
import { PointerFilterContext } from './pointers';

// Label buttons default to BUTTON_SIZE; icon buttons pass a square `size`.

function useSvgImage(svg) {
    const [image, setImage] = useState(null);
    useEffect(() => {
        if (svg == null) return;
        let alive = true;
        loadSvgImage(svg).then((img) => { if (alive) setImage(img); });
        return () => { alive = false; };
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
        const fill = active ? BUTTON_ACTIVE_FILL : hovered ? 'rgba(70, 90, 190, 0.9)' : BUTTON_FILL;
        drawButton(ctx, 0, 0, w, h, { label, icon, svgImage, fill });
    }, [label, icon, svgImage, active, hovered]);

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
