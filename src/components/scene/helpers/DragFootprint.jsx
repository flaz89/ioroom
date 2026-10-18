import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { surfaceAlong, surfacesBehind } from '../controls/surfaceDrag';

// Calibration knobs
const FOOTPRINT_SPREAD = 1.3;   // pattern diameter relative to the object's bounding sphere diameter
const FOOTPRINT_OPACITY = 0.9;  // overall opacity of the dot pattern
const FOOTPRINT_LIFT = 0.003;   // meters above the surface (avoids z-fighting)
const WALL_CONTACT = 0.1;       // board meters: body this close to a room wall = footprint on that wall
const PROBE_LIFT = 0.02;        // the per-dot surface probes start this far in front of the plane
const DOT_GRID = 20;            // dots per side of the pattern (flatscreen)
const DOT_GRID_XR = 60;         // in a headset dots look much bigger: 3x finer pattern, same extent
const PROBE_GRID = 20;          // surface probes per side (finer dot grids share probes: XR = 3x3 dots each)
const DOT_COLORS = ['#ffa500', '#ff6a00'];     // center -> edge (center = the selection outline orange)
const BLOCKED_COLORS = ['#ff3b30', '#c40000']; // dots outside the allowed space (no surface behind them)

/*
* "Terrain scan" dot layout (Death Stranding-like): a grid of round dots that shrink and fade from the
* center outwards, inside the inscribed circle. Computed once per grid density. Each dot knows its
* surface probe (PROBE_GRID cell); `probes` lists the probe cells actually used, with their position
* on the unit plane (PlaneGeometry: x right, y up; canvas row 0 = top = +y with the default flipY).
*/
const layouts = new Map();
function getDotLayout(grid) {
    if (layouts.has(grid)) return layouts.get(grid);
    const size = grid > 30 ? 1024 : 512; // keep ~17+ px per cell so small dots stay round
    const cell = size / grid;
    const dots = [];
    const probeIndex = new Map(); // probe cell -> index in `probes`
    const probes = [];
    for (let row = 0; row < grid; row++) {
        for (let column = 0; column < grid; column++) {
            const x = (column + 0.5) * cell;
            const y = (row + 0.5) * cell;
            // 0 at the center, 1 at the inscribed circle: dots outside it are not drawn
            const distance = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
            if (distance >= 1) continue;
            const radius = cell * 0.42 * Math.pow(1 - distance, 0.5);
            if (radius < 0.75) continue;
            const probeRow = Math.floor((row * PROBE_GRID) / grid);
            const probeColumn = Math.floor((column * PROBE_GRID) / grid);
            const key = probeRow * PROBE_GRID + probeColumn;
            if (!probeIndex.has(key)) {
                probeIndex.set(key, probes.length);
                probes.push(new THREE.Vector3((probeColumn + 0.5) / PROBE_GRID - 0.5, 0.5 - (probeRow + 0.5) / PROBE_GRID, 0));
            }
            dots.push({ x, y, radius, distance, probe: probeIndex.get(key) });
        }
    }
    const layout = { size, dots, probes };
    layouts.set(grid, layout);
    return layout;
}

// Draws the dots on the canvas: orange where the probe found a surface, red where it did not
const _center = new THREE.Color();
const _edge = new THREE.Color();
const _color = new THREE.Color();
function drawDots(context, layout, inside) {
    context.clearRect(0, 0, layout.size, layout.size);
    for (const dot of layout.dots) {
        const colors = inside[dot.probe] ? DOT_COLORS : BLOCKED_COLORS;
        _color.copy(_center.set(colors[0])).lerp(_edge.set(colors[1]), dot.distance);
        context.globalAlpha = 1 - dot.distance * 0.5;
        context.fillStyle = `#${_color.getHexString()}`;
        context.beginPath();
        context.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
        context.fill();
    }
}

// Canvas texture + probe buffers for one footprint. `inside`/`drawn`: probe results now / at the last redraw.
function createPattern(grid) {
    const layout = getDotLayout(grid);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = layout.size;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4; // dots stay crisp on the floor at grazing angles
    return {
        grid,
        layout,
        texture,
        context: canvas.getContext('2d'),
        points: layout.probes.map(() => new THREE.Vector3()),
        inside: new Uint8Array(layout.probes.length),
        drawn: null
    };
}

// Never hit by surface casts or pointers: the footprint must not become a support or catch clicks
const noRaycast = () => {};

const _scale = new THREE.Vector3();
const _size = new THREE.Vector3();
const _parentScale = new THREE.Vector3();
const _boxCenter = new THREE.Vector3();
const _probeDirection = new THREE.Vector3();
const _box = new THREE.Box3();
const _parentInverse = new THREE.Matrix4();
const _direction = new THREE.Vector3();
const _planeZ = new THREE.Vector3(0, 0, 1); // PlaneGeometry faces +Z
const _down = new THREE.Vector3(0, -1, 0);
const _wallAxes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];

// Room wall the body touches (within WALL_CONTACT, closest first), or null: near grabs and drags on the
// floor have no wall support, but pushed against a wall the dots belong on it
function touchedWall(target, body) {
    let best = null;
    let bestGap = WALL_CONTACT;
    for (const axis of _wallAxes) {
        const hit = surfaceAlong(target, body, axis);
        if (hit == null || !hit.isWall) continue;
        const gap = hit.distance - Math.abs(axis.dot(hit.box.getSize(_size))) / 2;
        if (gap <= bestGap) { bestGap = gap; best = hit; }
    }
    return best;
}

/*
* Dotted "terrain scan" footprint on the surface an object is being moved over, so the user sees
* where it is (and where it lands) in depth, even far away in VR:
* - on a wall support (getSupportNormal() vertical) or pushed against a room wall: on that wall;
* - otherwise: on the surface straight below (floor, a table top...), also for hung objects.
* Dots are orange where there is a surface behind them, RED where they fall outside the allowed space
* (one probe ray per dot cell, every frame). With nothing at all below the object (e.g. a gizmo drag
* outside the room) the dots stay on the last surface plane, all red.
* Must be rendered as a SIBLING of the target (same parent = board space), so it follows the
* tabletop scale like the objects do. Works for ray drags, near grabs and gizmo drags (the body
* bounds include the gizmo delta).
*/
export default function DragFootprint({ targetRef, bodyRef, getSupportNormal }) {
    const meshRef = useRef();
    const lastHitRef = useRef(null); // { point, normal } of the last surface found (nothing below now)
    const isXR = useXR((state) => state.mode != null);
    const grid = isXR ? DOT_GRID_XR : DOT_GRID;

    // Per-footprint canvas texture (its dots depend on where this footprint is), rebuilt when the dot
    // grid changes (XR on/off) and redrawn only when the probe results change. Kept in a ref: it is
    // mutated every frame.
    const patternRef = useRef(null);
    useEffect(() => () => patternRef.current?.texture.dispose(), []);
    useFrame(() => {
        const mesh = meshRef.current;
        const target = targetRef.current;
        const body = bodyRef.current;
        if (!mesh || !target || !body) return;

        // Which surface: the wall the object is attached to, else a room wall it touches, else the one below
        const support = getSupportNormal?.();
        const onWall = support != null && Math.abs(support.y) < 0.5;
        let hit = onWall ? surfaceAlong(target, body, _direction.copy(support).negate()) : null;
        if (hit == null) hit = touchedWall(target, body);
        if (hit == null) hit = surfaceAlong(target, body, _down);

        if (hit != null) {
            lastHitRef.current = { point: hit.point.clone(), normal: hit.normal.clone() };
        } else if (lastHitRef.current == null) {
            mesh.visible = false;
            return;
        }
        mesh.visible = true;

        // Pose: on the surface plane, facing out of it, centered under/behind the body
        const { normal, point } = hit ?? lastHitRef.current;
        target.updateWorldMatrix(false, true);
        const box = _box.setFromObject(body).applyMatrix4(_parentInverse.copy(target.parent.matrixWorld).invert());
        box.getCenter(_boxCenter);
        const planeOffset = point.dot(normal) - _boxCenter.dot(normal);
        mesh.position.copy(_boxCenter).addScaledVector(normal, planeOffset + FOOTPRINT_LIFT);
        mesh.quaternion.setFromUnitVectors(_planeZ, normal);

        // Pattern size from the bounding SPHERE (board space): rotation-invariant, so turning the object
        // (e.g. a capsule laid down) never resizes the pattern or its dots
        const geometry = body.geometry;
        if (geometry.boundingSphere == null) geometry.computeBoundingSphere();
        body.getWorldScale(_scale);
        target.parent.getWorldScale(_parentScale);
        const scale = Math.max(_scale.x, _scale.y, _scale.z) / _parentScale.x; // the board scales uniformly
        const extent = 2 * geometry.boundingSphere.radius * scale * FOOTPRINT_SPREAD;
        mesh.scale.set(extent, extent, 1);

        // Per-dot probes: from each probe cell (just in front of the plane) towards the surface.
        // ~300 probe rays per frame, each only against the triangles in the footprint's column (surfaceDrag.surfacesBehind).
        if (patternRef.current?.grid !== grid) {
            patternRef.current?.texture.dispose();
            patternRef.current = createPattern(grid);
            mesh.material.map = patternRef.current.texture;
            mesh.material.needsUpdate = true;
        }
        const pattern = patternRef.current;
        const { layout, points, inside } = pattern;
        mesh.updateMatrix();
        for (let i = 0; i < points.length; i++) {
            points[i].copy(layout.probes[i]).applyMatrix4(mesh.matrix).addScaledVector(normal, PROBE_LIFT);
        }
        surfacesBehind(target, points, _probeDirection.copy(normal).negate(), inside);

        // Redraw only when some dot changed color (a still or freely moving object costs no upload)
        if (pattern.drawn == null || inside.some((value, i) => value !== pattern.drawn[i])) {
            drawDots(pattern.context, layout, inside);
            pattern.texture.needsUpdate = true;
            pattern.drawn = inside.slice();
        }
    });

    return (
        <mesh ref={meshRef} raycast={noRaycast} renderOrder={1} visible={false}>
            <planeGeometry />
            <meshBasicMaterial transparent opacity={FOOTPRINT_OPACITY} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
    );
}
