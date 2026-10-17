import { useLayoutEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import { useHandle } from '@react-three/handle';
import { useTwoHandZoom } from './useTwoHandZoom';
import { useStore } from '../../../store/appStore';
import { activeLevel, levelBounds } from '../../../plan/planModel';

/*
* Root of the environment (room + objects). Identity in 'life' mode; in 'tabletop' mode it becomes a
* miniature model on a virtual table in front of the user, like a board game.
*
* Tabletop interactions (XR):
* - grab the room (floor/walls) with one hand/controller -> move the board and turn it around Y;
* - pinch/press with BOTH hands anywhere and pull apart / together -> zoom, clamped to
*   [MIN_SCALE, MAX_SCALE] (useTwoHandZoom: does not depend on both hands hitting the board).
* Objects stay children of the board, so their stored transforms remain in real-world (1:1) units.
*
* The board turns and scales around the room origin, so on entering tabletop it is placed with the FLOOR
* PLAN's center (planModel.levelBounds) on the table point, and its initial scale fits the plan in about
* TABLETOP_RADIUS (a 6 x 6 m room: ~1:12, as before; a big house starts smaller, a small room larger).
* Placement constants are calibration knobs: tune them on the headset.
*/
const TABLETOP_RADIUS = 0.37;           // meters: radius of the plan on the table at the initial scale
const MIN_SCALE = 1 / 40;
const MAX_SCALE = 1 / 3;
const TABLE_DISTANCE = 0.6;              // meters in front of the eyes (horizontal)
const TABLE_BELOW_EYES = 0.65;           // meters below the eyes (~ table height when standing)
const MIN_TABLE_HEIGHT = 0.5;            // meters from the floor (seated users)

const _eye = new Vector3();
const _forward = new Vector3();
const _center = new Vector3();
const _up = new Vector3(0, 1, 0);

export default function Board({ isTabletop, room, children }) {
    const boardRef = useRef();
    const roomRef = useRef(); // grab handle of the board (objects have their own handles)
    const getThree = useThree((state) => state.get);

    const boardHandle = useHandle(boardRef, {
        handle: roomRef,
        filter: () => isTabletop, // 1:1 mode: the room is not grabbable
        translate: true,
        rotate: { x: false, y: true, z: false }, // the table stays horizontal
        scale: false,      // zoom is the two-hand gesture below
        multitouch: false
    });

    useTwoHandZoom(boardRef, {
        enabled: isTabletop,
        minScale: MIN_SCALE,
        maxScale: MAX_SCALE,
        onStart: () => boardHandle.cancel() // a one-hand board drag in progress hands over to the zoom
    });

    // Enter tabletop: place the board in front of the user, its open side (+Z) facing them.
    // Back to life: identity. Imperative, so Handle-driven changes are not overwritten by re-renders.
    useLayoutEffect(() => {
        const board = boardRef.current;
        if (!isTabletop) {
            board.position.set(0, 0, 0);
            board.rotation.set(0, 0, 0);
            board.scale.setScalar(1);
            return;
        }
        const camera = getThree().camera; // follows the headset during XR sessions
        camera.getWorldPosition(_eye);
        camera.getWorldDirection(_forward).setY(0);
        if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1); // looking straight down
        _forward.normalize();

        const { center, radius } = levelBounds(activeLevel(useStore.getState().plan));
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, TABLETOP_RADIUS / radius));
        const yaw = Math.atan2(-_forward.x, -_forward.z); // board +Z -> towards the user
        // table point, minus the plan's center as it ends up after the board's turn and scale
        _center.set(center[0], 0, center[1]).applyAxisAngle(_up, yaw).multiplyScalar(scale);
        board.position.copy(_eye).addScaledVector(_forward, TABLE_DISTANCE).sub(_center);
        board.position.y = Math.max(_eye.y - TABLE_BELOW_EYES, MIN_TABLE_HEIGHT);
        board.rotation.set(0, yaw, 0);
        board.scale.setScalar(scale);
    }, [isTabletop, getThree]);

    return (
        <group ref={boardRef}>
            <group ref={roomRef}>{room}</group>
            {children}
        </group>
    );
}
