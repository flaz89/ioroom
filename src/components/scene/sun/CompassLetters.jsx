import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { useStore } from '../../../store/appStore';

/*
* Geographic directions written on the floor around the room, like on a map: N (orange), E, S, W.
* Inside the Board (level/Level.jsx), in room units: at 1:1 they lie on the ground outside the walls,
* in tabletop mode around the miniature, turning with it. They follow the room orientation (store
* sun.northDeg, set by the owner). Flat, unlit, never in the way: no raycast, no shadows.
* Calibration knobs: RADIUS (outside the wall corners of the 6x6 m room, ~4.35 m), SIZE.
*/
const RADIUS = 4.7;   // room meters from the center
const SIZE = 0.7;     // room meters, letter height
const HEIGHT = 0.01;  // just above the floor (no z-fighting with the grid)
const LETTERS = [['N', 0, '#ff9a1a'], ['E', 90, '#ffffff'], ['S', 180, '#ffffff'], ['W', 270, '#ffffff']];
const noRaycast = () => null;

// One small texture per letter (canvas: no font download, works on both renderers)
function letterTexture(letter, color) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = '700 104px "SUSE Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 64, 70);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

export default function CompassLetters() {
    const northDeg = useStore((state) => state.sun.northDeg);
    const textures = useMemo(() => LETTERS.map(([letter, , color]) => letterTexture(letter, color)), []);
    useEffect(() => () => textures.forEach((texture) => texture.dispose()), [textures]);

    return (
        <group position-y={HEIGHT}>
            {LETTERS.map(([letter, offset], index) => {
                // Bearing in room space: clockwise from -Z seen from above (same as sunDirection, sun.js)
                const bearing = (northDeg + offset) * Math.PI / 180;
                return (
                    // Turned so the letter's top points towards the room: readable from outside, where the model
                    // is seen from in tabletop mode and on desktop (at 1:1, from inside, the walls hide the floor)
                    <group key={letter} position={[Math.sin(bearing) * RADIUS, 0, -Math.cos(bearing) * RADIUS]} rotation-y={Math.PI - bearing}>
                        <mesh rotation-x={-Math.PI / 2} raycast={noRaycast}>
                            <planeGeometry args={[SIZE, SIZE]} />
                            <meshBasicMaterial map={textures[index]} transparent depthWrite={false} toneMapped={false} />
                        </mesh>
                    </group>
                );
            })}
        </group>
    );
}
