import { useState } from 'react';
import { drawPanel, useCanvasTexture } from './useCanvasTexture';
import { BUTTON_SIZE } from './layout';

// Label buttons default to BUTTON_SIZE; icon buttons pass a square `size`.
const PIXELS_PER_METER = 4000; // canvas resolution: crisp at arm's length, cheap to redraw

/*
* Which pointers can press menu buttons (pmndrs pointerEventsType filter, state = XR input source state):
* - hands: only the index-finger "touch" pointer. The hand ray is excluded (no accidental presses
*   while aiming at the scene; rays pass through the menu) and so is the "grab" pointer, which sits on
*   the same fingertip and would otherwise win ties against "touch".
* - controllers: the ray (trigger), since controllers have no touch pointer.
*/
function acceptsPointer(_pointerId, pointerType, pointerState) {
    if (pointerType === 'touch') return true;
    return pointerType === 'ray' && pointerState?.type === 'controller';
}

/*
* Flat in-VR button. Pressed with the controller/hand ray or by poking it with the index finger
* (pmndrs pointer events from @react-three/xr). `active` highlights toggles that are on.
* Content: a text `label`, or an `icon(ctx, x, y, size)` drawing function (see objectIcons.js).
*/
export default function VRButton({ label, icon, size = BUTTON_SIZE, active = false, onClick, ...groupProps }) {
    const [hovered, setHovered] = useState(false);
    const [width, height] = size;

    const texture = useCanvasTexture(Math.round(width * PIXELS_PER_METER), Math.round(height * PIXELS_PER_METER), (ctx, w, h) => {
        const fill = active ? 'rgba(255, 150, 40, 0.9)' : hovered ? 'rgba(70, 90, 190, 0.9)' : 'rgba(16, 20, 48, 0.85)';
        drawPanel(ctx, w, h, fill);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#ffffff';
        if (icon) {
            const iconSize = Math.min(w, h) * 0.62;
            icon(ctx, w / 2, h / 2, iconSize);
            return;
        }
        ctx.font = `600 ${Math.round(h * (label.length > 6 ? 0.32 : 0.4))}px "SUSE Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, w / 2, h / 2 + 2);
    }, [label, icon, active, hovered]);

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
