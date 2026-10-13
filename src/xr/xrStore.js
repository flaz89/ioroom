import { createXRStore } from '@react-three/xr';
import { useStore } from '../store/appStore';

/*
* Single XR store shared by the UI (enter buttons) and the <XR> component inside the Canvas.
* When the Canvas is remounted with a different renderer, <XR> re-binds the new renderer's
* WebXRManager to this same store, so the store survives backend swaps.
*/
export const xrStore = createXRStore({
    hand: {
        // Poking a button with the index finger lasts longer than pmndrs' default 300 ms click window
        // (press -> release), which made touch presses never fire onClick.
        touchPointer: { clickThresholdMs: 1500 }
    }
});

/*
* Enter an immersive session ("immersive-vr" | "immersive-ar").
* WebXR has no WebGPU binding, so the Canvas is first swapped to a WebGLRenderer and the session
* is requested only once that renderer is mounted. The swap is fast enough to stay within the
* browser's user-activation window started by the button click.
*/
export async function enterXR(mode) {
    const { setBackend, restoreBackend } = useStore.getState();
    setBackend('webgl');
    await waitForReadyBackend('webgl');
    try {
        return await xrStore.enterXR(mode);
    } catch (error) {
        restoreBackend();
        throw error;
    }
}

// Resolves when the mounted renderer matches the requested backend
function waitForReadyBackend(backend) {
    return new Promise((resolve) => {
        if (useStore.getState().renderer.readyBackend === backend) return resolve();
        const unsubscribe = useStore.subscribe((state) => {
            if (state.renderer.readyBackend !== backend) return;
            unsubscribe();
            resolve();
        });
    });
}

// Session ended (headset removed, "exit" pressed...): back to the preferred flatscreen backend and 1:1 view
xrStore.subscribe((state, prevState) => {
    if (prevState.session == null || state.session != null) return;
    const { restoreBackend, setViewMode } = useStore.getState();
    restoreBackend();
    setViewMode('life');
});
