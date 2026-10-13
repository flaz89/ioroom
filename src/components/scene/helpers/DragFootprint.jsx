import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { surfaceBelow } from '../controls/surfaceDrag';

// Calibration knobs
const FOOTPRINT_SPREAD = 2.2;   // pattern size relative to the object's footprint (dots spill outside it)
const FOOTPRINT_OPACITY = 0.9;  // overall opacity of the dot pattern
const FOOTPRINT_LIFT = 0.003;   // meters above the surface (avoids z-fighting)
const DOT_GRID = 20;            // dots per side of the pattern (flatscreen)
const DOT_GRID_XR = 60;         // in a headset dots look much bigger: 3x finer pattern, same extent
const DOT_COLORS = ['#ffa500', '#ff6a00']; // center -> edge (center = the selection outline orange)

/*
* "Terrain scan" texture (Death Stranding-like): a grid of round dots that shrink and fade from the
* center outwards, in a gradient of the selection orange. One cached texture per grid density,
* shared by all footprints (WebGL and WebGPU).
*/
const dotsTextures = new Map();
function getDotsTexture(grid) {
    if (dotsTextures.has(grid)) return dotsTextures.get(grid);
    const size = grid > 30 ? 1024 : 512; // keep ~17+ px per cell so small dots stay round
    const cell = size / grid;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    const center = new THREE.Color(DOT_COLORS[0]);
    const edge = new THREE.Color(DOT_COLORS[1]);
    const color = new THREE.Color();
    for (let row = 0; row < grid; row++) {
        for (let column = 0; column < grid; column++) {
            const x = (column + 0.5) * cell;
            const y = (row + 0.5) * cell;
            // 0 at the center, 1 at the inscribed circle: dots outside it are not drawn
            const distance = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
            if (distance >= 1) continue;
            const radius = cell * 0.42 * Math.pow(1 - distance, 0.5);
            if (radius < 0.75) continue;
            color.copy(center).lerp(edge, distance);
            context.globalAlpha = 1 - distance * 0.5;
            context.fillStyle = `#${color.getHexString()}`;
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.fill();
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4; // dots stay crisp on the floor at grazing angles
    dotsTextures.set(grid, texture);
    return texture;
}

// Never hit by surface casts or pointers: the footprint must not become a support or catch clicks
const noRaycast = () => {};

const _size = new THREE.Vector3();

/*
* Dotted "terrain scan" footprint on the surface straight below a grabbed object, so the user sees where it
* is (and where it lands) in depth, even when it hangs on a wall or is far away in VR.
* Must be rendered as a SIBLING of the target (same parent = board space), so it follows the
* tabletop scale like the objects do.
*/
export default function DragFootprint({ targetRef, bodyRef }) {
    const meshRef = useRef();
    const isXR = useXR((state) => state.mode != null);
    const texture = getDotsTexture(isXR ? DOT_GRID_XR : DOT_GRID); // module-level cache: created once

    useFrame(() => {
        const mesh = meshRef.current;
        const target = targetRef.current;
        if (!mesh || !target) return;
        const below = surfaceBelow(target, bodyRef.current);
        mesh.visible = below != null;
        if (below == null) return;
        const box = below.box;
        box.getSize(_size);
        mesh.position.set(below.point.x, below.point.y + FOOTPRINT_LIFT, below.point.z);
        // square pattern (round dots) covering the larger side of the object
        const extent = Math.max(_size.x, _size.z) * FOOTPRINT_SPREAD;
        mesh.scale.set(extent, extent, 1);
    });

    return (
        <mesh ref={meshRef} rotation-x={-Math.PI / 2} raycast={noRaycast} renderOrder={1} visible={false}>
            <planeGeometry />
            <meshBasicMaterial map={texture} transparent opacity={FOOTPRINT_OPACITY} depthWrite={false} toneMapped={false} />
        </mesh>
    );
}
