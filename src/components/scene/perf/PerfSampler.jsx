import { useEffect, useRef } from 'react';
import { addAfterEffect, useThree } from '@react-three/fiber';
import { useStore } from '../../../store/appStore';

const SAMPLE_INTERVAL_MS = 500; // how often stats are published to the store

/*
* Human-readable GPU name, to verify which GPU/driver is really in use.
* - WebGPU: GPUAdapterInfo exposed on the device (vendor / architecture / description).
* - WebGL: unmasked renderer string when the browser allows it.
*/
function describeGpu(gl) {
    if (gl.isWebGPURenderer) {
        const info = gl.backend.device?.adapterInfo;
        return info ? [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || null : null;
    }
    const context = gl.getContext();
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
    return context.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : context.RENDERER);
}

/*
* Reads renderer.info into a renderer-agnostic snapshot.
* - WebGPURenderer: draw calls, triangles, resources and an estimate of GPU memory in bytes (info.memory.total).
* - WebGLRenderer: same counters except GPU memory, which WebGL does not expose.
* Must be read right AFTER rendering: WebGPURenderer resets renderer.info at the start of each
* animation frame, before R3F renders, so a useFrame callback would always read zeros.
*/
function readStats(gl, frames, elapsedMs, gpuMs, gpuName) {
    const info = gl.info;
    const isWebGPU = gl.isWebGPURenderer === true;
    const heap = performance.memory; // non-standard, Chromium only

    return {
        backend: isWebGPU ? 'WebGPU' : 'WebGL',
        gpuName,
        fps: (frames * 1000) / elapsedMs,
        frameMs: elapsedMs / frames,
        gpuMs, // null when GPU timestamps are unavailable
        drawCalls: isWebGPU ? info.render.drawCalls : info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        shaders: isWebGPU ? info.memory.programs : (info.programs?.length ?? 0),
        gpuMemoryBytes: isWebGPU ? info.memory.total : null,
        jsHeapUsedBytes: heap?.usedJSHeapSize ?? null,
        jsHeapLimitBytes: heap?.jsHeapSizeLimit ?? null
    };
}

/*
* Collects frame statistics inside the Canvas and publishes them to the store every SAMPLE_INTERVAL_MS.
* Mounted only while the performance panel is open. Runs as an R3F after-effect (after each rendered frame).
*
* GPU time (WebGPU only): the renderer is created with trackTimestamp, so every frame we resolve the
* timestamp queries (async GPU readback) and average the results over the sample window.
* ponytail: no GPU time on WebGL; add EXT_disjoint_timer_query_webgl2 if it becomes necessary.
*/
export default function PerfSampler() {
    const setPerfStats = useStore((state) => state.setPerfStats);

    // Accumulators for the current sample window (mutable, no re-render)
    // (window start is set on the first frame: render must stay pure)
    const sample = useRef({ frames: 0, start: null, gpuMsSum: 0, gpuSamples: 0, resolving: false, gpuName: undefined });

    const getThree = useThree((state) => state.get);

    useEffect(() => addAfterEffect(() => {
        const gl = getThree().gl;
        const acc = sample.current;
        acc.start ??= performance.now();
        if (acc.gpuName === undefined) acc.gpuName = describeGpu(gl); // once per Canvas/renderer
        acc.frames++;

        // One readback in flight at a time; three.js handles query-pool overflow on its own
        if (gl.isWebGPURenderer && gl.backend.trackTimestamp && !acc.resolving) {
            acc.resolving = true;
            gl.resolveTimestampsAsync('render')
                .then((ms) => {
                    if (ms == null) return;
                    acc.gpuMsSum += ms;
                    acc.gpuSamples++;
                })
                .finally(() => { acc.resolving = false; });
        }

        const now = performance.now();
        const elapsed = now - acc.start;
        if (elapsed < SAMPLE_INTERVAL_MS) return;

        const gpuMs = acc.gpuSamples > 0 ? acc.gpuMsSum / acc.gpuSamples : null;
        setPerfStats(readStats(gl, acc.frames, elapsed, gpuMs, acc.gpuName));

        acc.frames = 0;
        acc.start = now;
        acc.gpuMsSum = 0;
        acc.gpuSamples = 0;
    }), [getThree, setPerfStats]);

    // Panel closed (or Canvas remounted on a backend swap): drop stale numbers
    useEffect(() => () => setPerfStats(null), [setPerfStats]);

    return null;
}
