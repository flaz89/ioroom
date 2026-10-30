import { useEffect, useState } from 'react';
import { createXRStore } from '@react-three/xr';
import { useStore } from '../store/appStore';
import { setAwaySource } from '../sync/presence';

/*
* Single XR store shared by the UI (enter buttons) and the <XR> component inside the Canvas.
* When the Canvas is remounted with a different renderer, <XR> re-binds the new renderer's
* WebXRManager to this same store, so the store survives backend swaps.
*/
/*
* Ray cursor size (meters, world): pmndrs draws a fixed 10 cm glow where a ray hits. Right for a 1:1
* room, huge on the tabletop model (~50 cm wide, scale 1/12): there it shrinks with the model.
* Calibration knobs: tune on the headset.
*/
const CURSOR_SIZE = 0.1;
const TABLETOP_CURSOR_SIZE = 0.015;
// Ray and cursor (the glow where it hits) color: the app's orange. pmndrs' default white at 0.4 opacity read as
// grey and got lost on walls, doors and windows
const RAY_COLOR = '#ff9a1a';
const RAY_MODEL = { color: RAY_COLOR };

/*
* Sorting of the fingertip (touch) pointer's hits. pmndrs' sphere intersector ignores pointerEventsOrder
* (it sorts by distance only), so a post-it card a few millimeters off a wall (less than a millimeter on
* the tabletop model) lost the touch to the wall, which comes first in the scene. This restores the
* documented rule for touch too: higher pointerEventsOrder (on the object or its nearest ancestor that
* sets one) wins, then the nearest hit. Return < 0 when i1 must win.
*/
function pointerEventsOrderOf(object) {
    for (let o = object; o != null; o = o.parent) if (o.pointerEventsOrder != null) return o.pointerEventsOrder;
    return 0;
}
function sortByOrderThenDistance(i1, _order1, i2) {
    const order1 = pointerEventsOrderOf(i1.object);
    const order2 = pointerEventsOrderOf(i2.object);
    return order1 !== order2 ? order2 - order1 : i1.distance - i2.distance;
}

const handOptions = (cursorSize) => ({
    // Poking a button with the index finger lasts longer than pmndrs' default 300 ms click window
    // (press -> release), which made touch presses never fire onClick.
    touchPointer: { clickThresholdMs: 1500, customSort: sortByOrderThenDistance },
    rayPointer: { cursorModel: { size: cursorSize, color: RAY_COLOR }, rayModel: RAY_MODEL }
});
const controllerOptions = (cursorSize) => ({ rayPointer: { cursorModel: { size: cursorSize, color: RAY_COLOR }, rayModel: RAY_MODEL } });

/*
* Quest 2 calibration knobs (tune on the headset):
* - frame rate: pmndrs picks the HIGHEST supported rate by default (90/120 Hz on a Quest 2); the scene runs at
*   ~51 fps, so the headset never hit the target and kept reprojecting (judder). 72 Hz is reachable.
* - foveation: three's default is 1 (maximum), the edges of the view rendered at very low resolution (jagged
*   beams at the top of the view). 0.5 still saves GPU, with much sharper edges.
*/
const XR_FRAME_RATE = 72;
const XR_FOVEATION = 0.5;

export const xrStore = createXRStore({
    // No desktop VR emulator (pmndrs injects one on localhost by default): testing happens on the headset
    emulate: false,
    foveation: XR_FOVEATION,
    // the supported rate closest to XR_FRAME_RATE
    frameRate: (rates) => rates.reduce((best, rate) => Math.abs(rate - XR_FRAME_RATE) < Math.abs(best - XR_FRAME_RATE) ? rate : best),
    hand: handOptions(CURSOR_SIZE),
    controller: controllerOptions(CURSOR_SIZE)
});

/*
* AWAY in VR (sync/presence.js): the immersive session reports 'hidden' when the headset is taken off /
* goes to standby ('visible-blurred' = a system menu over the app: still here). Session end = not away.
*/
let watchedSession = null;
const onSessionVisibility = () => setAwaySource('xr', watchedSession?.visibilityState === 'hidden');
xrStore.subscribe((state) => {
    if (state.session === watchedSession) return;
    watchedSession?.removeEventListener('visibilitychange', onSessionVisibility);
    watchedSession = state.session ?? null;
    watchedSession?.addEventListener('visibilitychange', onSessionVisibility);
    onSessionVisibility();
});

/*
* Input options for the current view: tabletop on/off resizes the ray cursors; in VR LIFE mode the LEFT hand
* has NO pointer at all (ray, grab, fingertip touch): its pinch only teleports (TeleportGesture.jsx). Its
* fingertip touching an object or a measure handle used to start a drag, even with the hand open; panels
* are pressed with the right hand (the wrist menu already ignores the left fingertip). setHand / setController swap the pmndrs input implementation options; re-applied when the view
* mode or the session mode changes.
*/
function applyInputOptions() {
    const isTabletop = useStore.getState().view.mode === 'tabletop';
    const size = isTabletop ? TABLETOP_CURSOR_SIZE : CURSOR_SIZE;
    const teleports = !isTabletop && xrStore.getState().mode === 'immersive-vr';
    xrStore.setHand(teleports ? { default: handOptions(size), left: { ...handOptions(size), rayPointer: false, grabPointer: false, touchPointer: false } } : handOptions(size));
    xrStore.setController(controllerOptions(size));
}
useStore.subscribe((state, previousState) => {
    if (state.view.mode !== previousState.view.mode) applyInputOptions();
});
xrStore.subscribe((state, previousState) => {
    if (state.mode !== previousState.mode) applyInputOptions();
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

/*
* Whether this browser can start an immersive session of `mode` right now. Re-checked on 'devicechange',
* so on a Windows PC a headset connected later through Quest Link / Air Link / SteamVR (OpenXR) enables
* the desktop VR button without a reload. Starting the session still needs a click (WebXR rule).
*/
export function useXRModeSupported(mode) {
    const [supported, setSupported] = useState(false);
    useEffect(() => {
        const xr = navigator.xr;
        if (xr == null) return;
        let canceled = false;
        const check = () => xr.isSessionSupported(mode)
            .then((value) => { if (!canceled) setSupported(value); })
            .catch(() => { if (!canceled) setSupported(false); });
        check();
        xr.addEventListener('devicechange', check);
        return () => {
            canceled = true;
            xr.removeEventListener('devicechange', check);
        };
    }, [mode]);
    return supported;
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
