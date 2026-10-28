import { Vector3 } from 'three';

/*
* Joint readings shared by the left-hand gestures (FistDeleteGesture.jsx, TeleportGesture.jsx).
*/
const _wrist = new Vector3();
const _middleKnuckle = new Vector3();
const _indexKnuckle = new Vector3();
const _pinkyKnuckle = new Vector3();
const _along = new Vector3();
const _across = new Vector3();
const _toUser = new Vector3();

// Joint position in the reference space, or false if not tracked this frame
export function readJoint(frame, hand, joint, referenceSpace, target) {
    const pose = frame.getJointPose?.(hand.get(joint), referenceSpace);
    if (pose == null) return false;
    target.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
    return true;
}

/*
* LEFT hand orientation and height, or null if not tracked:
* - fingersUp: y of wrist -> middle knuckle (the direction the fingers point);
* - backToUser: back-of-hand normal . horizontal direction hand -> eyes. The normal is along x (index knuckle
*   -> pinky knuckle): for the LEFT hand it points out of the BACK of the hand (fingers up, palm away from
*   you: index on the right, pinky on the left, so the cross product points at you). Knuckles barely move
*   when making a fist or a pinch, so it stays valid while closing;
* - drop: meters from the eyes down to the wrist (negative = hand above the eyes).
* `eyes`: viewer position (same reference space).
*/
export function measureHandPose(frame, hand, referenceSpace, eyes) {
    if (!readJoint(frame, hand, 'wrist', referenceSpace, _wrist)) return null;
    if (!readJoint(frame, hand, 'middle-finger-phalanx-proximal', referenceSpace, _middleKnuckle)) return null;
    if (!readJoint(frame, hand, 'index-finger-phalanx-proximal', referenceSpace, _indexKnuckle)) return null;
    if (!readJoint(frame, hand, 'pinky-finger-phalanx-proximal', referenceSpace, _pinkyKnuckle)) return null;
    _along.subVectors(_middleKnuckle, _wrist).normalize();
    _across.subVectors(_pinkyKnuckle, _indexKnuckle);
    const back = _across.crossVectors(_along, _across).normalize();
    _toUser.subVectors(eyes, _wrist).setY(0).normalize();
    return { fingersUp: _along.y, backToUser: back.dot(_toUser), drop: eyes.y - _wrist.y };
}
