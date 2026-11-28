import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../../../store/appStore';
import { setWakeHandler } from './renderWake';

// Calibration knobs
const AWAKE_MS = 1500; // frames keep coming this long after the last change: camera damping, door easing
                       // (~0.6 s) and TRAA converging on a still image (it averages ~30 jittered frames)
// Store keys that only REPORT on the rendering and change nothing on screen: they must not wake it, or the
// report feeds itself (the performance panel publishes stats every 500 ms -> wake -> frames -> new stats...:
// with the panel open the scene never rested)
const REPORT_ONLY_KEYS = new Set(['perf']); // perfSlice.js: { stats }

/*
* ON-DEMAND RENDERING (flatscreen; the Canvas uses frameloop "demand", Scene.jsx): nothing is drawn while the
* scene is still, so the GPU rests (it used to redraw the whole SSGI / TRAA chain 120 times a second on a
* ProMotion screen, image unchanged: heat, fans, battery).
* R3F already draws a frame on its own after a React render and when the camera controls move. Everything
* else that animates over several frames (useFrame: door easing, damping tails, TRAA accumulation, remote
* avatars) needs frames to keep coming: this driver keeps invalidating every animation frame while AWAKE, i.e.
* for AWAKE_MS after the last
*   - pointer press / drag (a move with a button held), wheel, keyboard event or window resize,
*   - frame asked for by something else (a React render, the camera controls): a hover that changes the
*     scene (tint, note growing, ruler preview) goes through React, so a plain pointer MOVE does not wake the
*     rendering on its own. On the Quest the hand ray trembles over the browser panel and its endless moves
*     kept the GPU busy with SSGI / TRAA for an unchanged image: the panel glitched (pixel columns jumping,
*     magenta / yellow) and the passthrough stuttered,
*   - change of the app store (settings, plan, materials, sun, room content from the other devices...;
*     not the REPORT_ONLY_KEYS),
*   - wakeRender() call (renderWake.js: presence updates).
* The frame-rate cap (60 fps) is in PostEffects.jsx, where the frame is actually rendered.
* ponytail: continuous animations (the post-it motion graphics) freeze while the scene is still; give them a
* wakeRender() of their own if they must run idle.
*/
export default function FrameDriver() {
    const invalidate = useThree((state) => state.invalidate);
    const driver = useRef({ ownFrame: false, wake: null });

    // a frame this driver did not ask for: something changed on screen, keep the frames coming
    useFrame(() => {
        if (!driver.current.ownFrame) driver.current.wake?.();
        driver.current.ownFrame = false;
    });

    useEffect(() => {
        const self = driver.current;
        let awakeUntil = 0;
        let raf = 0;
        const tick = () => {
            raf = 0;
            if (performance.now() > awakeUntil) return; // asleep: no more frames until the next wake
            self.ownFrame = true;
            invalidate();
            raf = requestAnimationFrame(tick);
        };
        const wake = () => {
            awakeUntil = performance.now() + AWAKE_MS;
            if (raf === 0) raf = requestAnimationFrame(tick);
        };
        self.wake = wake;
        const drag = (event) => { if (event.buttons !== 0) wake(); };
        const events = ['pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup', 'resize'];
        events.forEach((type) => window.addEventListener(type, wake, { passive: true }));
        window.addEventListener('pointermove', drag, { passive: true });
        // a store change wakes the rendering unless it touched only REPORT_ONLY_KEYS
        const unsubscribe = useStore.subscribe((state, previous) => {
            for (const key in state) {
                if (state[key] !== previous[key] && !REPORT_ONLY_KEYS.has(key)) return wake();
            }
        });
        setWakeHandler(wake);
        wake(); // a few frames to start with (and after coming back from XR / the 2D plan)
        return () => {
            cancelAnimationFrame(raf);
            events.forEach((type) => window.removeEventListener(type, wake));
            window.removeEventListener('pointermove', drag);
            self.wake = null;
            unsubscribe();
            setWakeHandler(null);
        };
    }, [invalidate]);

    return null;
}
