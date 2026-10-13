import { useEffect, useRef } from 'react';
import { Euler, Quaternion, Vector3 } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useXRInputSourceState } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { TWIST_TO_YAW, twistAngle, twistWithDeadzone } from '../controls/surfaceDrag';

/*
* Rotates the SELECTED object with a THUMB-MIDDLE pinch of the right hand (hand tracking) and the same
* wrist twist as the controller rays: the object turns around the vertical axis and never moves.
* (The index pinch is the system "select": it moves objects, so rotation lives on another finger.)
* - pinch starts below PINCH_START, ends above PINCH_END (hysteresis: no flicker while twisting);
* - yaw = start yaw - TWIST_TO_YAW x wrist twist around the forearm (dead zone included, like rays);
* - the rotation snap setting (step in degrees) applies;
* - nothing happens while the object is being held (grabbedId) or with nothing selected.
*/
const GESTURE_HAND = 'right';
const PINCH_START = 0.015; // meters between thumb and middle fingertips: pinch on (tune on the headset)
const PINCH_END = 0.03;    // ...and off

const _thumb = new Vector3();
const _middle = new Vector3();
const _wrist = new Quaternion();
const _twist = new Quaternion();
const _yaw = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _rotation = new Quaternion();
const _euler = new Euler();

export default function PinchRotateGesture() {
    const gestureHand = useXRInputSourceState('hand', GESTURE_HAND);
    const gl = useThree((state) => state.gl);
    // While pinching: { id, start (object quaternion), startYaw, reference (wrist^-1), axis, yaw }
    const rotationRef = useRef(null);

    // Leaving XR mid-pinch must not resume a stale rotation next session
    useEffect(() => () => { rotationRef.current = null; }, []);

    useFrame((_state, _frameDelta, frame) => {
        const hand = gestureHand?.inputSource.hand;
        if (hand == null || frame == null) return;
        const space = gl.xr.getReferenceSpace();
        const thumb = frame.getJointPose?.(hand.get('thumb-tip'), space);
        const middle = frame.getJointPose?.(hand.get('middle-finger-tip'), space);
        const wrist = frame.getJointPose?.(hand.get('wrist'), space);
        if (thumb == null || middle == null || wrist == null) return; // tracking lost: keep the state

        const { objects, settings, updateObject } = useStore.getState();
        const distance = _thumb.copy(thumb.transform.position).distanceTo(_middle.copy(middle.transform.position));
        const pinching = distance < (rotationRef.current ? PINCH_END : PINCH_START);
        if (!pinching || objects.selectedId == null || objects.grabbedId != null) {
            rotationRef.current = null;
            return;
        }

        _wrist.copy(wrist.transform.orientation);
        const rotation = rotationRef.current;
        if (rotation?.id !== objects.selectedId) {
            const object = objects.instances.find((o) => o.id === objects.selectedId);
            if (object == null) return;
            const start = new Quaternion().setFromEuler(_euler.fromArray(object.rotation));
            rotationRef.current = {
                id: object.id,
                start,
                startYaw: 2 * Math.atan2(start.y, start.w), // exact for upright objects
                reference: _wrist.clone().invert(),
                axis: new Vector3(0, 0, -1).applyQuaternion(_wrist), // forearm direction (joint -Z = towards the fingers)
                yaw: 0
            };
            return;
        }

        // Yaw delta from the wrist twist; with the snap on, the resulting absolute yaw lands on the step
        _twist.multiplyQuaternions(_wrist, rotation.reference);
        let yaw = -TWIST_TO_YAW * twistWithDeadzone(twistAngle(_twist, rotation.axis));
        if (settings.rotationSnap) {
            const step = (settings.rotationSnapStep * Math.PI) / 180;
            yaw = Math.round((rotation.startYaw + yaw) / step) * step - rotation.startYaw;
        }
        if (Math.abs(yaw - rotation.yaw) < 1e-4) return; // no store update (and re-render) for nothing
        rotation.yaw = yaw;

        // World-up turn applied on top of the start orientation (keeps any tilt the gizmo gave it)
        _rotation.multiplyQuaternions(_yaw.setFromAxisAngle(_up, yaw), rotation.start);
        _euler.setFromQuaternion(_rotation);
        updateObject(rotation.id, { rotation: [_euler.x, _euler.y, _euler.z] });
    });

    return null;
}
