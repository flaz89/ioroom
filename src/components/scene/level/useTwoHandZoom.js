import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { zoomAboutMidpoint } from '../controls/boardZoom';

/*
* Two-hand zoom of the tabletop board, independent of what the hands are pointing at:
* press with BOTH hands (pinch / trigger / grip) anywhere and pull them apart or together.
* - scale = initial scale * current hand distance / initial hand distance, clamped to [minScale, maxScale];
* - the board scales around the midpoint between the hands and follows that midpoint (pan while zooming).
* Does not start while an object is held, so moving a piece with one hand never zooms the world.
*
* onStart: called once when the gesture begins (e.g. to cancel a one-hand board drag in progress).
*/
const _left = new Vector3();
const _right = new Vector3();
const _mid = new Vector3();

// XRRigidTransform position -> Vector3
const readPosition = (pose, target) => target.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);

export function useTwoHandZoom(boardRef, { enabled, minScale, maxScale, onStart }) {
    const gl = useThree((state) => state.gl);
    const session = useXR((state) => state.session);

    // Input sources with select (pinch/trigger) or squeeze (grip) held -> number of held actions
    const pressed = useRef(new Map());
    // Active gesture: initial hand distance/midpoint and board transform
    const gesture = useRef(null);

    useEffect(() => {
        if (session == null) return;
        const held = pressed.current;
        const press = (event) => held.set(event.inputSource, (held.get(event.inputSource) ?? 0) + 1);
        const release = (event) => {
            const count = (held.get(event.inputSource) ?? 1) - 1;
            if (count > 0) held.set(event.inputSource, count);
            else held.delete(event.inputSource);
        };
        const sourcesChanged = (event) => event.removed.forEach((source) => held.delete(source));
        session.addEventListener('selectstart', press);
        session.addEventListener('squeezestart', press);
        session.addEventListener('selectend', release);
        session.addEventListener('squeezeend', release);
        session.addEventListener('inputsourceschange', sourcesChanged);
        return () => {
            session.removeEventListener('selectstart', press);
            session.removeEventListener('squeezestart', press);
            session.removeEventListener('selectend', release);
            session.removeEventListener('squeezeend', release);
            session.removeEventListener('inputsourceschange', sourcesChanged);
            held.clear();
        };
    }, [session]);

    useFrame((_state, _delta, frame) => {
        const board = boardRef.current;
        let left;
        let right;
        for (const source of pressed.current.keys()) {
            if (source.handedness === 'left') left = source;
            if (source.handedness === 'right') right = source;
        }
        if (!enabled || frame == null || board == null || left == null || right == null) {
            gesture.current = null;
            return;
        }

        const referenceSpace = gl.xr.getReferenceSpace();
        const leftPose = frame.getPose(left.gripSpace ?? left.targetRaySpace, referenceSpace);
        const rightPose = frame.getPose(right.gripSpace ?? right.targetRaySpace, referenceSpace);
        if (leftPose == null || rightPose == null) return; // tracking lost for a frame
        readPosition(leftPose, _left);
        readPosition(rightPose, _right);
        const distance = _left.distanceTo(_right);
        _mid.addVectors(_left, _right).multiplyScalar(0.5);

        if (gesture.current == null) {
            if (useStore.getState().objects.grabbedId != null || distance < 1e-3) return;
            gesture.current = {
                distance,
                scale: board.scale.x,
                midpoint: _mid.clone(),
                position: board.position.clone()
            };
            onStart?.();
            return;
        }

        board.scale.setScalar(zoomAboutMidpoint(gesture.current, distance, _mid, minScale, maxScale, board.position));
    });
}
