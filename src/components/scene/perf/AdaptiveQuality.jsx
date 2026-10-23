import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../../../store/appStore';

// Calibration knobs
const MIN_FPS = 30;          // minimum frame rate (Flavio's rule): below it, Auto steps down
const WINDOW_MS = 2000;      // frame rate averaged over this window before deciding
const SETTLE_MS = 1500;      // after a change (or at start: shaders compiling, textures uploading) the
                             // frame rate is not representative: ignored for this long

/*
* Keeps the frame rate at MIN_FPS or above with the AUTO quality / resolution (settingSlice.js stepDownAuto:
* effects first, then sharpness). Averages the frame rate over WINDOW_MS windows; one window below MIN_FPS =
* one step down, then SETTLE_MS without measuring. Never steps back up during the visit (no oscillation).
* Forced quality and resolution are never touched (stepDownAuto only moves what is on Auto). Hidden page:
* requestAnimationFrame pauses, so the first window back is skipped (it would read a huge frame time).
* Replaces drei's PerformanceMonitor: here we decide the ORDER of the trade-offs.
*/
export default function AdaptiveQuality() {
    const measure = useRef({ start: null, frames: 0, settleUntil: 0 });

    useFrame(() => {
        const now = performance.now();
        const state = measure.current;
        if (now < state.settleUntil) return;
        if (state.start === null) {
            state.start = now;
            state.frames = 0;
            return;
        }
        state.frames += 1;
        const elapsed = now - state.start;
        if (elapsed < WINDOW_MS) return;
        const fps = (state.frames * 1000) / elapsed;
        state.start = null;
        if (elapsed > 2 * WINDOW_MS) return; // the page was hidden: not a real measure
        if (fps >= MIN_FPS) return;
        if (useStore.getState().stepDownAuto()) state.settleUntil = now + SETTLE_MS;
    });

    return null;
}
