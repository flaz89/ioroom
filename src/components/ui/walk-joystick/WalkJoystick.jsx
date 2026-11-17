import './walk-joystick.css';
import { useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../../../store/appStore';
import { xrStore } from '../../../xr/xrStore';
import { walkInput } from '../../scene/controls/walk';

const RADIUS = 45; // px the knob travels from the center
const coarse = typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)') : null;
const subscribeCoarse = (callback) => { coarse?.addEventListener('change', callback); return () => coarse?.removeEventListener('change', callback); };

/*
* Virtual joystick of the first-person tour on touch screens (WalkControls.jsx reads walkInput):
* push the knob to walk, its distance from the center = speed. Shown in the tour's first / third person views, out of XR,
* on coarse pointers only (desktop walks with WASD / arrows).
*/
export default function WalkJoystick() {
    const isWalking = useStore((state) => state.workspace === 'tour' && state.tourView !== 'orbit');
    const isXR = useSyncExternalStore(xrStore.subscribe, () => xrStore.getState().mode != null);
    const isTouch = useSyncExternalStore(subscribeCoarse, () => coarse?.matches ?? false);
    const [knob, setKnob] = useState([0, 0]);
    const center = useRef(null);
    if (!isWalking || isXR || !isTouch) return null;

    const follow = (event) => {
        if (center.current == null) return;
        let dx = event.clientX - center.current[0], dy = event.clientY - center.current[1];
        const length = Math.hypot(dx, dy);
        if (length > RADIUS) { dx *= RADIUS / length; dy *= RADIUS / length; }
        walkInput.x = dx / RADIUS;
        walkInput.y = -dy / RADIUS;
        setKnob([dx, dy]);
    };
    const release = () => {
        center.current = null;
        walkInput.x = 0;
        walkInput.y = 0;
        setKnob([0, 0]);
    };

    return (
        <div className="walk-joystick" aria-label="Walk"
            onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                const box = event.currentTarget.getBoundingClientRect();
                center.current = [box.left + box.width / 2, box.top + box.height / 2];
                follow(event);
            }}
            onPointerMove={follow} onPointerUp={release} onPointerCancel={release}>
            <div className="walk-joystick-knob" style={{ transform: `translate(${knob[0]}px, ${knob[1]}px)` }} />
        </div>
    );
}
