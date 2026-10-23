import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { useStore } from '../../store/appStore';

// Calibration knobs (tune on the real scenes, will move to the render settings)
const PROBE_SPACING = 1.5;  // meters between probes on the floor plane: finer = more detail, slower bake
const HEIGHT_PROBES = 3;    // probe levels from floor to ceiling
const HEIGHT_MARGIN = 0.5;  // meters above the walls, so roofs / ceilings sit inside the grid
const BOUNCES = 1;          // extra light bounces: each one is another full pass over the probes
const PROBES_PER_FRAME = 4; // bake work per frame (~3 ms per probe on an M2 Max): higher = faster but jerkier
const BAKE_DELAY = 300;     // ms without changes before a bake starts (no baking while a slider/drag moves)

/*
* Diffuse global illumination from a 3D grid of light probes (three.js LightProbeGrid, WebGPU only for now).
* Each probe captures the scene around it (tiny cubemaps -> spherical harmonics) and every lit material
* takes its indirect light from the nearest probes: under a roof the probes see walls and ceiling and the
* room gets darker, near doors and windows they see the sky and it gets brighter, walls bounce their color.
*
* BAKED, NOT PER FRAME: whenever the plan, the sun, the surface materials or the objects change (and then
* stay still for BAKE_DELAY) a PROGRESSIVE bake starts: PROBES_PER_FRAME probes each frame, pass 0 (direct
* light) then one pass per bounce, so the page never freezes and the light settles in a second or two. A new
* change restarts it from the first probe (never a stale half-old result). Every frame afterwards only reads
* a 3D texture (almost free).
* During each bake step the environment map is the sky (scene.background) at full strength, so the light
* coming in through the openings is captured; between steps Light.jsx keeps the environment low (reflections
* only) and the probes do the fill light.
*
* Sized on the plan's rectangle (levelBounds min/max) and the level wall height. Portaled to the scene root:
* LightProbeGrid reads its own position as a world position.
* Known limit: probes that end up inside a wall see black and darken the surfaces next to them.
*/
export default function LightProbes({ min, max, wallHeight, skyIntensity }) {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    // what the bake depends on (the values are only used as change triggers)
    const plan = useStore((state) => state.plan);
    const sun = useStore((state) => state.sun);
    const surfaces = useStore((state) => state.surfaces);
    const objects = useStore((state) => state.objects);

    const width = max[0] - min[0];
    const depth = max[1] - min[1];
    const height = wallHeight + HEIGHT_MARGIN;
    const grid = useMemo(() => {
        const probes = (meters) => Math.max(2, Math.round(meters / PROBE_SPACING) + 1);
        return new LightProbeGrid(width, height, depth, probes(width), HEIGHT_PROBES, probes(depth));
    }, [width, height, depth]);
    useEffect(() => () => grid.dispose(), [grid]);

    // The grid joins the scene only after its first bake step: before that it has no textures yet and its
    // light node is not registered with the renderer (the bake does both), so every lit material would be
    // drawn with an invalid binding ("Invalid CommandEncoder" each frame, "Light node not found" warnings).
    // The bake itself does not need the grid in the scene.
    const [bakedGrid, setBakedGrid] = useState(null);

    // progressive bake state: null = idle, { pass, next, startedAt } = baking
    const bake = useRef(null);
    useEffect(() => {
        bake.current = null; // a change stops the running bake at once
        const timer = setTimeout(() => {
            grid.position.set((min[0] + max[0]) / 2, height / 2, (min[1] + max[1]) / 2);
            grid.updateMatrixWorld();
            bake.current = { pass: 0, next: 0, startedAt: performance.now() };
        }, BAKE_DELAY);
        return () => clearTimeout(timer);
    }, [grid, min, max, height, plan, sun, surfaces, objects]);

    useFrame(() => {
        const state = bake.current;
        if (state === null) return;
        const { x, y, z } = grid.resolution;
        const total = x * y * z;
        const count = Math.min(PROBES_PER_FRAME, total - state.next);
        // the environment as a visible sky, at full strength, only during the bake step
        const saved = { background: scene.background, backgroundIntensity: scene.backgroundIntensity, environmentIntensity: scene.environmentIntensity };
        scene.background = scene.environment;
        scene.backgroundIntensity = scene.environmentIntensity = skyIntensity;
        try {
            grid.bake(gl, scene, { start: state.next, count, pass: state.pass });
        } finally {
            Object.assign(scene, saved);
        }
        if (bakedGrid !== grid) setBakedGrid(grid); // its textures and light node exist now: it can join the scene
        state.next += count;
        if (state.next < total) return;
        if (state.pass < BOUNCES) {
            state.pass += 1; // every indirect pass starts again at probe 0
            state.next = 0;
            return;
        }
        console.info(`[LightProbes] ${total} probes (${x}x${y}x${z}), ${BOUNCES} bounce(s), settled in ${Math.round(performance.now() - state.startedAt)} ms`);
        bake.current = null;
    });

    return bakedGrid === grid ? createPortal(<primitive object={grid} />, scene) : null;
}
