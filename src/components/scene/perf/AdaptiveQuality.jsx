import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../../../store/appStore';
import { autoLadder, autoStepIndex } from '../../../store/slices/settingSlice';

// Calibration knobs
const MIN_FPS = 30;           // minimum frame rate (Flavio's rule): below it, Auto steps down
const UP_FPS = 50;            // headroom: above it for UP_WINDOWS windows in a row, Auto tries one step up
const UP_WINDOWS = 3;         // windows in a row above UP_FPS before stepping up (6 s)
const WINDOW_MS = 2000;       // frame rate measured over this window before deciding
const START_SETTLE_MS = 3000; // after the first frame: shaders compiling, textures uploading (loading screen)
const SETTLE_MS = 3000;       // after a step (the effects chain is rebuilt and its shaders compile): ignored

/*
* Keeps the frame rate at MIN_FPS or above with the AUTO quality / resolution, moving along the AUTO LADDER
* (settingSlice.js autoLadder / stepAuto: effects first, then sharpness; only what is set to Auto moves).
* - Measures WINDOW_MS windows with the MEDIAN frame time (not the average): shader compiles and texture
*   uploads make a few very long frames that pulled the average under MIN_FPS right after a reload.
* - DOWN: one window under MIN_FPS = one step down; that step is remembered as FAILED for this visit.
* - UP: UP_WINDOWS windows in a row above UP_FPS = one step up, unless that step already failed in this visit
*   (no oscillation: at most one try per step and visit).
* - After a step, SETTLE_MS without measuring; nothing measured in the first START_SETTLE_MS.
* - The step reached is remembered on this device (settingSlice AUTO_KEY): the next visit starts there, so
*   Auto no longer lands somewhere different every time.
* - Hidden page: requestAnimationFrame pauses, so the first window back is skipped.
* Replaces drei's PerformanceMonitor: here we decide the ORDER of the trade-offs.
*/
export default function AdaptiveQuality() {
    const measure = useRef({ start: null, last: 0, deltas: [], settleUntil: null, good: 0, failed: new Set() });

    useFrame(() => {
        const now = performance.now();
        const state = measure.current;
        state.failed ??= new Set(); // a ref kept by hot reload from an older shape
        state.good ??= 0;
        if (state.settleUntil === null) state.settleUntil = now + START_SETTLE_MS; // first frame
        if (now < state.settleUntil) return;
        if (state.start === null || state.deltas === undefined) { // (undefined: a ref kept by hot reload from an older shape)
            state.start = now;
            state.last = now;
            state.deltas = [];
            return;
        }
        state.deltas.push(now - state.last);
        state.last = now;
        const elapsed = now - state.start;
        if (elapsed < WINDOW_MS) return;
        state.start = null;
        if (elapsed > 2 * WINDOW_MS) return; // the page was hidden: not a real measure
        const sorted = state.deltas.sort((a, b) => a - b);
        const fps = 1000 / sorted[Math.floor(sorted.length / 2)];

        const store = useStore.getState();
        const ladder = autoLadder(store.settings);
        const index = autoStepIndex(store.settings, store.autoDpr);
        const key = (i) => String(ladder[i]);
        if (fps < MIN_FPS) {
            state.good = 0;
            if (store.stepAuto(1)) {
                state.failed.add(key(Math.max(0, index)));
                state.settleUntil = now + SETTLE_MS;
            }
            return;
        }
        state.good = fps >= UP_FPS ? state.good + 1 : 0;
        if (state.good < UP_WINDOWS || index <= 0 || state.failed.has(key(index - 1))) return;
        state.good = 0;
        if (store.stepAuto(-1)) state.settleUntil = now + SETTLE_MS;
    });

    return null;
}
