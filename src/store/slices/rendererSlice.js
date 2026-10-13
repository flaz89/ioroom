import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';

/*
* Renderer backend state.
* - "backend": the backend the <Canvas> must be (re)created with. Changing it remounts the Canvas.
* - "readyBackend": the backend of the renderer that is actually mounted right now (set in Canvas onCreated).
*   Used to wait for the swap to finish before requesting an XR session.
* - "webgpuSupported": WebGPU is preferred on flatscreen when the browser exposes it. WebXR only provides
*   a WebGL layer, so XR sessions always run on WebGL (see src/xr/xrStore.js).
*/
export const createRendererSlice = (set) => ({

    renderer: {
        webgpuSupported: WebGPU.isAvailable(),
        backend: WebGPU.isAvailable() ? 'webgpu' : 'webgl',
        readyBackend: null
    },

    setBackend: (backend) =>
        set((state) => ({ renderer: { ...state.renderer, backend } })),

    setReadyBackend: (readyBackend) =>
        set((state) => ({ renderer: { ...state.renderer, readyBackend } })),

    // Back to the preferred flatscreen backend (after an XR session ends or fails to start)
    restoreBackend: () =>
        set((state) => ({
            renderer: { ...state.renderer, backend: state.renderer.webgpuSupported ? 'webgpu' : 'webgl' }
        })),

    // WebGPU is exposed but no usable adapter was found: stay on WebGL for the rest of the session
    disableWebGPU: () =>
        set((state) => ({ renderer: { ...state.renderer, webgpuSupported: false, backend: 'webgl' } }))
})
