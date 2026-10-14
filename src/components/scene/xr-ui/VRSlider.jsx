import { useContext, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { useCanvasTexture } from './useCanvasTexture';
import { PointerFilterContext } from './pointers';

const PIXELS_PER_METER = 4000; // same resolution as the wrist buttons
const HEIGHT = 0.05;           // meters: label on top, track below
const PAD = 0.012;             // meters: track inset from the sides (room for the knob)
const _local = new Vector3();

/*
* In-VR slider: a label ("Time 15:00") above a track with a knob, all drawn on one canvas texture.
* Drag with the controller ray (trigger) or slide the index fingertip along it (hand tracking):
* the pointer is captured on press, so the drag keeps working when the ray leaves the track.
* Same pointers as the buttons (pointers.js, PointerFilterContext). onChange runs only when the value changes.
* Props: label, value, min, max, step, onChange(value), width (meters), group props (position...).
*/
export default function VRSlider({ label, value, min, max, step = 1, onChange, width = 0.26, ...groupProps }) {
    const meshRef = useRef();
    const [isHovered, setIsHovered] = useState(false);
    const acceptsPointer = useContext(PointerFilterContext);
    const fraction = (value - min) / (max - min);

    const texture = useCanvasTexture(Math.round(width * PIXELS_PER_METER), Math.round(HEIGHT * PIXELS_PER_METER), (ctx, w, h) => {
        const pad = (PAD / width) * w;
        const trackY = h * 0.72;
        // Label
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${Math.round(h * 0.3)}px "SUSE Mono", monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, pad, h * 0.26);
        // Track: empty part, then the filled part up to the knob, in the selection orange
        ctx.lineCap = 'round';
        ctx.lineWidth = h * 0.1;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath(); ctx.moveTo(pad, trackY); ctx.lineTo(w - pad, trackY); ctx.stroke();
        const knobX = pad + fraction * (w - pad * 2);
        ctx.strokeStyle = '#ff9a1a';
        ctx.beginPath(); ctx.moveTo(pad, trackY); ctx.lineTo(knobX, trackY); ctx.stroke();
        // Knob (bigger while hovered)
        ctx.fillStyle = '#ff9a1a';
        ctx.beginPath(); ctx.arc(knobX, trackY, h * (isHovered ? 0.17 : 0.14), 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = h * 0.03; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    }, [label, fraction, isHovered]);

    // Value under the pointer: hit point in the slider's local space -> position along the track
    const setFromEvent = (event) => {
        meshRef.current.worldToLocal(_local.copy(event.point));
        const t = Math.min(Math.max((_local.x + width / 2 - PAD) / (width - PAD * 2), 0), 1);
        const next = Math.min(Math.max(min + Math.round((t * (max - min)) / step) * step, min), max);
        if (next !== value) onChange(next);
    };

    return (
        <group {...groupProps}>
            <mesh
                ref={meshRef}
                pointerEventsType={acceptsPointer}
                onPointerDown={(event) => {
                    event.stopPropagation();
                    event.target.setPointerCapture(event.pointerId);
                    setFromEvent(event);
                }}
                onPointerMove={(event) => {
                    if (event.target.hasPointerCapture(event.pointerId)) setFromEvent(event);
                }}
                onPointerUp={(event) => event.target.releasePointerCapture(event.pointerId)}
                onPointerEnter={() => setIsHovered(true)}
                onPointerLeave={() => setIsHovered(false)}
            >
                <planeGeometry args={[width, HEIGHT]} />
                <meshBasicMaterial map={texture} transparent toneMapped={false} />
            </mesh>
        </group>
    );
}
