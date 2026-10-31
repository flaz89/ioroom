import { useEffect, useRef } from 'react';
import { addAfterEffect, addEffect, useThree } from '@react-three/fiber';
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
* What really renders: a WebGPURenderer without a usable adapter runs on its WebGL2 backend (only briefly:
* the store then swaps to a WebGLRenderer), so the renderer type alone is not enough. XR sessions always
* run on WebGLRenderer (src/xr/xrStore.js: WebXR has no WebGPU binding).
*/
function backendLabel(gl) {
    const backend = gl.isWebGPURenderer ? (gl.backend.isWebGPUBackend ? 'WebGPU' : 'WebGPU on WebGL2') : 'WebGL';
    return gl.xr?.isPresenting ? `${backend} · XR` : backend;
}

/*
* Reads renderer.info into a renderer-agnostic snapshot.
* - WebGPURenderer: draw calls, triangles, resources and an estimate of GPU memory in bytes (info.memory.total).
* - WebGLRenderer: same counters except GPU memory, which WebGL does not expose.
* Must be read right AFTER rendering: WebGPURenderer resets renderer.info at the start of each
* animation frame, before R3F renders, so a useFrame callback would always read zeros.
*/
function readStats(gl, frames, elapsedMs, cpuMs, renderMs, gpuMs, gpuName) {
    const info = gl.info;
    const isWebGPU = gl.isWebGPURenderer === true;
    const heap = performance.memory; // non-standard, Chromium only

    return {
        backend: backendLabel(gl),
        gpuName,
        fps: (frames * 1000) / elapsedMs,
        frameMs: elapsedMs / frames,
        cpuMs,
        renderMs, // part of cpuMs spent in renderer.render (the rest = useFrame updates)
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
*
* CPU time: JavaScript time of one frame, from R3F's before-effects (start of the tick) to its after-effects:
* every useFrame (pmndrs pointers and XR included) + building and submitting the draw calls. GPU work runs
* asynchronously and is not in it: CPU close to Frame = CPU bound, far below = GPU (or compositor) bound.
* Split: renderer.render is timed by wrapping it (while the sampler is mounted): Render = three building and
* submitting the draw calls (shadow map + both eyes), Update = the rest (useFrame callbacks, XR pointers).
*/
export default function PerfSampler() {
    const setPerfStats = useStore((state) => state.setPerfStats);

    // Accumulators for the current sample window (mutable, no re-render)
    // (window start is set on the first frame: render must stay pure)
    const sample = useRef({ frames: 0, start: null, tickStart: null, cpuMsSum: 0, renderMsSum: 0, gpuMsSum: 0, gpuSamples: 0, resolving: false, gpuName: undefined });

    const getThree = useThree((state) => state.get);

    useEffect(() => addEffect(() => { sample.current.tickStart = performance.now(); }), []);

    useEffect(() => {
        const gl = getThree().gl;
        const render = gl.render;
        const acc = sample.current;
        gl.render = function timedRender(...args) {
            const start = performance.now();
            const result = render.apply(this, args);
            acc.renderMsSum += performance.now() - start;
            return result;
        };
        return () => { gl.render = render; };
    }, [getThree]);

    useEffect(() => addAfterEffect(() => {
        const gl = getThree().gl;
        const acc = sample.current;
        acc.start ??= performance.now();
        if (acc.tickStart != null) acc.cpuMsSum += performance.now() - acc.tickStart;
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
        const menuHidden = gl.xr?.isPresenting === true && !useStore.getState().view.handMenuVisible;
        setPerfStats(readStats(gl, acc.frames, elapsed, acc.cpuMsSum / acc.frames, acc.renderMsSum / acc.frames, gpuMs, acc.gpuName), menuHidden);

        acc.frames = 0;
        acc.cpuMsSum = 0;
        acc.renderMsSum = 0;
        acc.start = now;
        acc.gpuMsSum = 0;
        acc.gpuSamples = 0;
    }), [getThree, setPerfStats]);

    // Panel closed (or Canvas remounted on a backend swap): drop stale numbers
    useEffect(() => () => setPerfStats(null), [setPerfStats]);

    return null;
}
