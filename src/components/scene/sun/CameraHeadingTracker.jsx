import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Matrix4, Vector3 } from 'three';
import { getCameraHeading, publishCameraHeading } from './cameraHeading';

const MIN_CHANGE = 0.05; // degrees: below this, no notification (camera still)
const _forward = new Vector3();
const _toBoard = new Matrix4();

/*
* Publishes the camera heading (cameraHeading.js) every frame it changes.
* Follows the active camera: the orbit camera on flatscreen, the headset during XR sessions.
* Lives inside the Board (level/Level.jsx): the view direction is measured in the board's space, so a
* tabletop model turned by hand keeps its compass right.
*/
export function CameraHeadingTracker() {
    const anchorRef = useRef(); // empty group inside the board: its world matrix carries the board's rotation

    useFrame(({ camera }) => {
        camera.getWorldDirection(_forward);
        _forward.transformDirection(_toBoard.copy(anchorRef.current.matrixWorld).invert()); // world -> board
        // Looking straight down/up: the horizontal direction is undefined, keep the last heading
        if (Math.abs(_forward.x) + Math.abs(_forward.z) < 1e-4) return;
        const next = Math.atan2(_forward.x, -_forward.z) * 180 / Math.PI;
        if (Math.abs(next - getCameraHeading()) < MIN_CHANGE) return;
        publishCameraHeading(next);
    });

    return <group ref={anchorRef} />;
}
