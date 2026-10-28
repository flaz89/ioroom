import { useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useXRInputSourceState } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { createFistGesture, isDeletePose } from './fistGesture';
import { isLockedByOther } from '../../../sync/presence';
import { measureHandPose, readJoint } from './handPose';

/*
* Deletes the selected object with an "open hand -> fist" gesture of the LEFT hand (hand tracking):
* select with the right hand, then hold the left hand up (fingers up, BACK of the hand towards you, palm
* perpendicular to the floor) and close it into a fist.
* The left hand also carries the wrist menu: while the menu is shown (palm facing the eyes) the
* gesture cannot arm, so closing the hand after using the menu never deletes anything.
* While armed, objects.deleteArmed is true (the selected object's outline turns red).
* See fistGesture.js for the gesture rules and thresholds.
*/
const GESTURE_HAND = 'left';
const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];

const _wrist = new Vector3();
const _tip = new Vector3();
const _knuckle = new Vector3();
const _eyes = new Vector3();

// Average fingertip-wrist / knuckle-wrist ratio (see fistGesture.js), null if not tracked
function measureOpenness(frame, hand, referenceSpace) {
    if (!readJoint(frame, hand, 'wrist', referenceSpace, _wrist)) return null;
    let sum = 0;
    for (const finger of FINGERS) {
        if (!readJoint(frame, hand, `${finger}-tip`, referenceSpace, _tip)) return null;
        if (!readJoint(frame, hand, `${finger}-phalanx-proximal`, referenceSpace, _knuckle)) return null;
        sum += _tip.distanceTo(_wrist) / Math.max(_knuckle.distanceTo(_wrist), 1e-4);
    }
    return sum / FINGERS.length;
}

export default function FistDeleteGesture() {
    const gestureHand = useXRInputSourceState('hand', GESTURE_HAND);
    const gl = useThree((state) => state.gl);
    const gesture = useMemo(() => createFistGesture(), []);
    const inPose = useRef(false); // hysteresis state of isDeletePose

    // Leaving XR while armed must not leave the red outline behind
    useEffect(() => () => useStore.getState().setDeleteArmed(false), []);

    useFrame((_state, _delta, frame) => {
        const hand = gestureHand?.inputSource.hand;
        if (hand == null || frame == null) return;

        const { objects, view, setDeleteArmed, removeObject } = useStore.getState();
        const referenceSpace = gl.xr.getReferenceSpace();
        const openness = measureOpenness(frame, hand, referenceSpace);
        const viewer = frame.getViewerPose(referenceSpace)?.transform.position;
        const pose = viewer && measureHandPose(frame, hand, referenceSpace, _eyes.set(viewer.x, viewer.y, viewer.z));
        if (openness == null || pose == null) return; // tracking lost: keep the current state
        inPose.current = isDeletePose(pose.fingersUp, pose.backToUser, inPose.current);

        // Only with a selected object that is not being held, in the delete pose,
        // and never while the wrist menu is shown
        // (an object held by another device in a shared room cannot be deleted)
        const canArm = objects.selectedId != null && objects.grabbedId == null && !isLockedByOther(objects.selectedId)
            && inPose.current && !view.handMenuVisible;
        const result = gesture(performance.now(), openness, canArm);

        const armed = result === 'armed';
        if (armed !== objects.deleteArmed) setDeleteArmed(armed);
        if (result === 'fire') removeObject(objects.selectedId);
    });

    return null;
}
