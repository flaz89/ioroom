import { useRef } from 'react';
import { Quaternion, Vector3 } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../../../store/appStore';
import { activeLevel } from '../../../plan/planModel';
import { getXRBaseSpace, setXROrigin } from '../../../xr/xrOrigin';
import { groundHeight, startOrigin } from './teleport';

const _forward = new Vector3();
const _q = new Quaternion();

/*
* PLAYER START in VR / AR (life mode; mounted by Level.jsx): at the start of each session, as soon as the
* headset reports a pose, the XR origin (xr/xrOrigin.js) is placed so that the user stands on the plan's player
* start (planModel level.playerStart, placed in the Designer) looking its way. No start: the room stays where
* the headset's space puts it, as before. Once per session: walking and teleporting go on from there.
*/
export default function XRPlayerStart() {
    const gl = useThree((state) => state.gl);
    const placed = useRef(null); // the session already placed

    useFrame((_state, _delta, frame) => {
        const session = gl.xr.getSession();
        if (frame == null || session == null || placed.current === session) return;
        const level = activeLevel(useStore.getState().plan);
        const start = level.playerStart;
        if (start == null) { placed.current = session; return; }
        const head = frame.getViewerPose(getXRBaseSpace(gl))?.transform;
        if (head == null) return; // not tracking yet: next frame
        const o = head.orientation;
        _forward.set(0, 0, -1).applyQuaternion(_q.set(o.x, o.y, o.z, o.w));
        const headYaw = Math.atan2(-_forward.x, -_forward.z);
        setXROrigin(gl, startOrigin(start, [head.position.x, head.position.z], headYaw), groundHeight(level, start.p));
        placed.current = session;
    });

    return null;
}
