import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { clearPointer, publishPointer, remotePointers, useRoomUsers } from '../../../sync/presence';
import NameLabel from './NameLabel';

/*
* Shared-room pointers (see sync/presence.js), rendered INSIDE the Board (board space: they follow the
* tabletop model like the objects do):
* - this device (desktop/mobile, not in XR): where its mouse/touch points in the scene is published;
* - every other device that shares a pointer: a 3D arrow in its color, tip on the pointed surface and
*   standing out along its normal (readable from any angle), plus a name label above it, easing towards
*   each received position.
* Calibration knobs in board meters (real size at 1:1, scaled down with the tabletop model).
*/
const ARROW_HEAD = [0.045, 0.1];   // arrow head cone [radius, length]; its tip is the pointed point
const ARROW_SHAFT = [0.014, 0.12]; // arrow shaft [radius, length], behind the head
const LABEL_HEIGHT = 0.32;         // label center above the pointed point
const LABEL_SIZE = [0.36, 0.09];   // label sprite [width, height]
const FOLLOW_RATE = 18;            // 1/s: how fast a remote pointer eases towards the received point

const noRaycast = () => {};        // markers never catch pointers nor block the local pointer ray
const _ndc = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();
const _point = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _boardQuaternion = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export default function RemotePointers() {
    const anchorRef = useRef();     // child of the board: its parent is the board root
    const users = useRoomUsers();
    const others = users.filter((user) => !user.isSelf);
    const isXR = useXR((state) => state.mode != null);

    return (
        <group ref={anchorRef}>
            {!isXR && <LocalPointer anchorRef={anchorRef} />}
            {others.map((user) => <RemotePointer key={user.clientId} user={user} />)}
        </group>
    );
}

/*
* Publishes this device's pointer: the canvas pointer position is cast into the scene (only after it
* moved), and the first surface hit is shared in board space. Leaving the canvas clears it.
*/
function LocalPointer({ anchorRef }) {
    const gl = useThree((state) => state.gl);
    const camera = useThree((state) => state.camera);
    const pointerRef = useRef({ moved: false, inside: false });

    useEffect(() => {
        const element = gl.domElement;
        const move = (event) => {
            const rect = element.getBoundingClientRect();
            _ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
            pointerRef.current.moved = true;
            pointerRef.current.inside = true;
        };
        const leave = () => {
            pointerRef.current.inside = false;
            clearPointer();
        };
        element.addEventListener('pointermove', move);
        element.addEventListener('pointerleave', leave);
        return () => {
            element.removeEventListener('pointermove', move);
            element.removeEventListener('pointerleave', leave);
            clearPointer();
        };
    }, [gl]);

    useFrame(() => {
        const pointer = pointerRef.current;
        const board = anchorRef.current?.parent;
        if (!pointer.moved || !pointer.inside || board == null) return;
        pointer.moved = false;
        _raycaster.setFromCamera(_ndc, camera);
        const hit = _raycaster.intersectObject(board, true).find((h) => h.face != null && h.object.isMesh && !h.object.isLineSegments2);
        if (hit == null) return clearPointer();
        board.worldToLocal(_point.copy(hit.point));
        board.getWorldQuaternion(_boardQuaternion).invert();
        _normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).applyQuaternion(_boardQuaternion);
        publishPointer(_point, _normal);
    });

    return null;
}

// Another device's pointer: colored arrow onto the surface + name label, hidden while it points at nothing
function RemotePointer({ user }) {
    const groupRef = useRef();
    const arrowRef = useRef();

    useFrame((_state, delta) => {
        const group = groupRef.current;
        const pointer = remotePointers.get(user.clientId);
        if (pointer == null) {
            group.visible = false;
            return;
        }
        _point.fromArray(pointer.p);
        if (!group.visible) group.position.copy(_point); // appears where it is, no glide from the old spot
        group.visible = true;
        group.position.lerp(_point, 1 - Math.exp(-delta * FOLLOW_RATE));
        arrowRef.current.quaternion.setFromUnitVectors(_up, _normal.fromArray(pointer.n).normalize()); // +Y = out of the surface
    });

    return (
        <group ref={groupRef} visible={false}>
            {/* arrow built along local +Y, tip at the origin (the pointed point), rotated onto the surface normal */}
            <group ref={arrowRef}>
                <mesh position={[0, ARROW_HEAD[1] / 2, 0]} rotation={[Math.PI, 0, 0]} raycast={noRaycast} renderOrder={10}>
                    <coneGeometry args={[ARROW_HEAD[0], ARROW_HEAD[1], 20]} />
                    <meshBasicMaterial color={user.color} depthTest={false} toneMapped={false} />
                </mesh>
                <mesh position={[0, ARROW_HEAD[1] + ARROW_SHAFT[1] / 2, 0]} raycast={noRaycast} renderOrder={10}>
                    <cylinderGeometry args={[ARROW_SHAFT[0], ARROW_SHAFT[0], ARROW_SHAFT[1], 12]} />
                    <meshBasicMaterial color={user.color} depthTest={false} toneMapped={false} />
                </mesh>
            </group>
            <NameLabel name={user.name} color={user.color} size={LABEL_SIZE} position={[0, LABEL_HEIGHT, 0]} />
        </group>
    );
}
