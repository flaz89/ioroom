import { useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useXRInputSourceState } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { createFistGesture, isPalmVertical } from './fistGesture';

/*
* Deletes the selected object with an "open hand -> fist" gesture of the LEFT hand (hand tracking):
* select with the right hand, open and close the left one, palm perpendicular to the floor.
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
const _middleKnuckle = new Vector3();
const _indexKnuckle = new Vector3();
const _pinkyKnuckle = new Vector3();
const _along = new Vector3();
const _across = new Vector3();

// Joint position in the reference space, or false if not tracked this frame
function readJoint(frame, hand, joint, referenceSpace, target) {
    const pose = frame.getJointPose?.(hand.get(joint), referenceSpace);
    if (pose == null) return false;
    target.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
    return true;
}

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

// y of the unit palm normal, from wrist -> middle knuckle (along the hand) and index -> pinky knuckle
// (across the palm). These joints barely move when making a fist, so it stays valid while closing.
// Only the absolute value is used, so the sign convention (left/right hand) does not matter.
function measurePalmNormalY(frame, hand, referenceSpace) {
    if (!readJoint(frame, hand, 'wrist', referenceSpace, _wrist)) return null;
    if (!readJoint(frame, hand, 'middle-finger-phalanx-proximal', referenceSpace, _middleKnuckle)) return null;
    if (!readJoint(frame, hand, 'index-finger-phalanx-proximal', referenceSpace, _indexKnuckle)) return null;
    if (!readJoint(frame, hand, 'pinky-finger-phalanx-proximal', referenceSpace, _pinkyKnuckle)) return null;
    _along.subVectors(_middleKnuckle, _wrist);
    _across.subVectors(_pinkyKnuckle, _indexKnuckle);
    return _along.cross(_across).normalize().y;
}

export default function FistDeleteGesture() {
    const gestureHand = useXRInputSourceState('hand', GESTURE_HAND);
    const gl = useThree((state) => state.gl);
    const gesture = useMemo(() => createFistGesture(), []);
    const palmVertical = useRef(false); // hysteresis state of isPalmVertical

    // Leaving XR while armed must not leave the red outline behind
    useEffect(() => () => useStore.getState().setDeleteArmed(false), []);

    useFrame((_state, _delta, frame) => {
        const hand = gestureHand?.inputSource.hand;
        if (hand == null || frame == null) return;

        const { objects, view, setDeleteArmed, removeObject } = useStore.getState();
        const referenceSpace = gl.xr.getReferenceSpace();
        const openness = measureOpenness(frame, hand, referenceSpace);
        const palmNormalY = measurePalmNormalY(frame, hand, referenceSpace);
        if (openness == null || palmNormalY == null) return; // tracking lost: keep the current state
        palmVertical.current = isPalmVertical(palmNormalY, palmVertical.current);

        // Only with a selected object that is not being held, with the palm perpendicular to the floor,
        // and never while the wrist menu is shown
        const canArm = objects.selectedId != null && objects.grabbedId == null
            && palmVertical.current && !view.handMenuVisible;
        const result = gesture(performance.now(), openness, canArm);

        const armed = result === 'armed';
        if (armed !== objects.deleteArmed) setDeleteArmed(armed);
        if (result === 'fire') removeObject(objects.selectedId);
    });

    return null;
}
