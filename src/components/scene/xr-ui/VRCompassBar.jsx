import { useEffect, useMemo } from 'react';
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { useStore } from '../../../store/appStore';
import { subscribeCameraHeading } from '../sun/cameraHeading';
import { skyMarkers } from '../sun/sunLighting';

/*
* In-VR version of the desktop compass bar (components/ui/compass/CompassBar.jsx), for the VR sun panel:
* a tape of geographic directions that scrolls as the head turns, with the sun (day) or the moon (night).
*
* Cheap on the headset: the 360° tape is drawn ONCE on a canvas (again only when the sun/moon marker
* moves); turning the head only shifts the texture offset (repeat-wrapped), no redraw, no React render.
*/
const PX_PER_DEGREE = 4;
const TAPE_W = 360 * PX_PER_DEGREE;
const TAPE_H = 120;
const VISIBLE_DEGREES = 180;
const LABELS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const normalize = (degrees) => ((degrees % 360) + 360) % 360;
const noRaycast = () => null;

// Draws a marker at azimuth `degrees`, twice near the seam so it is never cut by the wrap
function drawAt(ctx, degrees, draw) {
    const x = degrees * PX_PER_DEGREE;
    draw(x);
    if (x < 40) draw(x + TAPE_W);
    if (x > TAPE_W - 40) draw(x - TAPE_W);
}

export default function VRCompassBar({ width, height = 0.03, ...groupProps }) {
    const sun = useStore((state) => state.sun);
    const northDeg = sun.northDeg;
    const { sunAzimuth, moonAzimuth } = useMemo(() => skyMarkers(sun), [sun]);

    const texture = useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = TAPE_W;
        canvas.height = TAPE_H;
        const tex = new CanvasTexture(canvas);
        tex.colorSpace = SRGBColorSpace;
        tex.wrapS = RepeatWrapping;
        tex.repeat.x = VISIBLE_DEGREES / 360;
        return tex;
    }, []);
    useEffect(() => () => texture.dispose(), [texture]);

    // Tape: ticks, labels, sun/moon. Redrawn only when the markers move.
    useEffect(() => {
        const ctx = texture.image.getContext('2d');
        ctx.clearRect(0, 0, TAPE_W, TAPE_H);
        for (let degree = 0; degree < 360; degree += 15) {
            const label = LABELS[degree];
            ctx.fillStyle = label ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)';
            drawAt(ctx, degree, (x) => ctx.fillRect(x - 2, TAPE_H - (label ? 30 : 18), 4, label ? 30 : 18));
            if (label) {
                ctx.fillStyle = label === 'N' ? '#ff9a1a' : '#ffffff';
                ctx.font = '700 40px "SUSE Mono", monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                drawAt(ctx, degree, (x) => ctx.fillText(label, x, TAPE_H - 52));
            }
        }
        if (sunAzimuth != null) {
            ctx.fillStyle = '#ffd27a';
            drawAt(ctx, sunAzimuth, (x) => { ctx.beginPath(); ctx.arc(x, 18, 13, 0, Math.PI * 2); ctx.fill(); });
        }
        if (moonAzimuth != null) {
            ctx.fillStyle = '#eef2ff';
            drawAt(ctx, moonAzimuth, (x) => {
                ctx.beginPath(); ctx.arc(x, 18, 13, 0, Math.PI * 2); ctx.fill();
                ctx.globalCompositeOperation = 'destination-out'; // carve the crescent
                ctx.beginPath(); ctx.arc(x - 7, 15, 12, 0, Math.PI * 2); ctx.fill();
                ctx.globalCompositeOperation = 'source-over';
            });
        }
        // eslint-disable-next-line react-hooks/immutability -- three.js textures are mutable by design
        texture.needsUpdate = true;
    }, [texture, sunAzimuth, moonAzimuth]);

    // Head turns: scroll the tape so the geographic heading sits in the middle
    useEffect(() => subscribeCameraHeading((roomHeading) => {
        texture.offset.x = (normalize(roomHeading - northDeg) - VISIBLE_DEGREES / 2) / 360;
    }), [texture, northDeg]);

    return (
        <group {...groupProps}>
            <mesh raycast={noRaycast}>
                <planeGeometry args={[width, height]} />
                <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
            </mesh>
            {/* Center mark: current heading (opaque, depth-written: the translucent panel background must not cover it) */}
            <mesh raycast={noRaycast} position={[0, height / 2 - height * 0.15, 0.001]}>
                <planeGeometry args={[0.0025, height * 0.3]} />
                <meshBasicMaterial color="#ff9a1a" toneMapped={false} />
            </mesh>
        </group>
    );
}
