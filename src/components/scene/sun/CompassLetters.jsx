import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { useStore } from '../../../store/appStore';
import { activeLevel, levelBounds } from '../../../plan/planModel';

/*
* Geographic directions written on the floor around the room, like on a map: N (orange), E, S, W.
* Inside the Board (level/Level.jsx), in room units: at 1:1 they lie on the ground outside the walls,
* in tabletop mode around the miniature, turning with it. They follow the room orientation (store
* sun.northDeg, set by the owner). Flat, unlit, never in the way: no raycast, no shadows.
* Centered on the floor plan, just outside its walls (levelBounds radius + MARGIN).
* Calibration knobs: MARGIN, SIZE.
*/
const MARGIN = 0.25;  // room meters beyond the plan's radius (6 x 6 room: ~4.7 m, as before)
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
    const level = useStore((state) => activeLevel(state.plan));
    const { center, radius } = useMemo(() => levelBounds(level), [level]);
    const distance = radius + MARGIN; // letters' distance from the plan's center
    const textures = useMemo(() => LETTERS.map(([letter, , color]) => letterTexture(letter, color)), []);
    useEffect(() => () => textures.forEach((texture) => texture.dispose()), [textures]);

    return (
        <group position={[center[0], HEIGHT, center[1]]}>
            {LETTERS.map(([letter, offset], index) => {
                // Bearing in room space: clockwise from -Z seen from above (same as sunDirection, sun.js)
                const bearing = (northDeg + offset) * Math.PI / 180;
                return (
                    // Turned so the letter's top points towards the room: readable from outside, where the model
                    // is seen from in tabletop mode and on desktop (at 1:1, from inside, the walls hide the floor)
                    <group key={letter} position={[Math.sin(bearing) * distance, 0, -Math.cos(bearing) * distance]} rotation-y={Math.PI - bearing}>
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
