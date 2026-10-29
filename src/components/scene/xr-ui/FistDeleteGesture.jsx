import { useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useXRInputSourceState } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { OPEN_RATIO, createFistGesture, isDeletePose } from './fistGesture';
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
const OTHER_FINGERS = FINGERS.slice(1); // all but the index: still open in a pinch, curled in a fist
// thumb-index tips closer than this with the other fingers open = a PINCH (the teleport, TeleportGesture.jsx),
// not a fist being made: it never arms the delete. Generous (the teleport's pinch-off distance)
const PINCH_DISTANCE = 0.03; // meters
// ...nor for this long after it: releasing a teleport leaves the hand open and raised, i.e. in the delete pose
const AFTER_PINCH_MS = 1000;

const _wrist = new Vector3();
const _tip = new Vector3();
const _knuckle = new Vector3();
const _thumb = new Vector3();
const _eyes = new Vector3();

// Average fingertip-wrist / knuckle-wrist ratio of `fingers` (see fistGesture.js), null if not tracked
function measureOpenness(frame, hand, referenceSpace, fingers = FINGERS) {
    if (!readJoint(frame, hand, 'wrist', referenceSpace, _wrist)) return null;
    let sum = 0;
    for (const finger of fingers) {
        if (!readJoint(frame, hand, `${finger}-tip`, referenceSpace, _tip)) return null;
        if (!readJoint(frame, hand, `${finger}-phalanx-proximal`, referenceSpace, _knuckle)) return null;
        sum += _tip.distanceTo(_wrist) / Math.max(_knuckle.distanceTo(_wrist), 1e-4);
    }
    return sum / fingers.length;
}

// Thumb on the index tip while middle, ring and pinky stay open (a fist curls them all)
function isPinching(frame, hand, referenceSpace) {
    if (!readJoint(frame, hand, 'thumb-tip', referenceSpace, _thumb)) return false;
    if (!readJoint(frame, hand, 'index-finger-tip', referenceSpace, _tip)) return false;
    if (_thumb.distanceTo(_tip) > PINCH_DISTANCE) return false;
    return (measureOpenness(frame, hand, referenceSpace, OTHER_FINGERS) ?? 0) > OPEN_RATIO;
}

export default function FistDeleteGesture() {
    const gestureHand = useXRInputSourceState('hand', GESTURE_HAND);
    const gl = useThree((state) => state.gl);
    const gesture = useMemo(() => createFistGesture(), []);
    const inPose = useRef(false); // hysteresis state of isDeletePose
    const lastPinchAt = useRef(-Infinity);

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
        // and never during / right after a teleport pinch
        const now = performance.now();
        if (isPinching(frame, hand, referenceSpace)) lastPinchAt.current = now;
        const canArm = objects.selectedId != null && objects.grabbedId == null && !isLockedByOther(objects.selectedId)
            && inPose.current && !view.handMenuVisible && now - lastPinchAt.current > AFTER_PINCH_MS;
        const result = gesture(now, openness, canArm);

        const armed = result === 'armed';
        if (armed !== objects.deleteArmed) setDeleteArmed(armed);
        if (result === 'fire') removeObject(objects.selectedId);
    });

    return null;
}
