import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useXR, useXRInputSourceState } from '@react-three/xr';
import { clearAvatar, publishAvatar, remoteAvatars, useRoomUsers } from '../../../sync/presence';
import NameLabel from './NameLabel';

/*
* Shared-room headset avatars (see sync/presence.js), rendered INSIDE the Board (board space):
* - this device, while in XR: its head (camera) and hands/controllers are published in board space,
*   with avatar scale = 1 / board scale (in tabletop the user is a "giant" leaning over the model);
* - every other headset user: a low-poly avatar in their color (head + visor, two hands, name tag),
*   easing towards each received pose. ~50 triangles per avatar.
* Calibration knobs in meters at avatar scale 1.
*/
const HEAD_RADIUS = 0.1;
const VISOR_SIZE = [0.15, 0.06, 0.05];  // dark headset front [width, height, depth]
const HAND_SIZE = [0.05, 0.025, 0.09];  // hand/controller block [width, height, length]
const LABEL_OFFSET = 0.22;              // name tag above the head center
const LABEL_SIZE = [0.36, 0.09];
const FOLLOW_RATE = 15;                 // 1/s: how fast an avatar eases towards the received pose

const noRaycast = () => {};
const _boardInverse = new THREE.Matrix4();
const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();

export default function RemoteAvatars() {
    const anchorRef = useRef(); // child of the board: its parent is the board root
    const others = useRoomUsers().filter((user) => !user.isSelf);
    const isXR = useXR((state) => state.mode != null);

    return (
        <group ref={anchorRef}>
            {isXR && <LocalAvatar anchorRef={anchorRef} />}
            {others.map((user) => <RemoteAvatar key={user.clientId} user={user} />)}
        </group>
    );
}

// World matrix -> board-space [px,py,pz, qx,qy,qz,qw] (uses _boardInverse, set per frame)
function toBoardPose(worldMatrix) {
    _matrix.multiplyMatrices(_boardInverse, worldMatrix).decompose(_position, _quaternion, _scale);
    return [..._position.toArray(), ..._quaternion.toArray()];
}

// Publishes this headset's head + hands every frame (presence.js throttles and skips still poses)
function LocalAvatar({ anchorRef }) {
    const gl = useThree((state) => state.gl);
    const camera = useThree((state) => state.camera);
    const leftController = useXRInputSourceState('controller', 'left');
    const leftHand = useXRInputSourceState('hand', 'left');
    const rightController = useXRInputSourceState('controller', 'right');
    const rightHand = useXRInputSourceState('hand', 'right');

    useEffect(() => clearAvatar, []); // leaving XR: the avatar disappears for the others

    useFrame((_state, _delta, frame) => {
        const board = anchorRef.current?.parent;
        if (board == null || frame == null) return;
        _boardInverse.copy(board.matrixWorld).invert();
        const referenceSpace = gl.xr.getReferenceSpace(); // = world space (no XROrigin offset in this app)

        // Hand/controller pose in board space, or null when that input source is not tracked
        const handPose = (state) => {
            const source = state?.inputSource;
            const pose = source && frame.getPose(source.gripSpace ?? source.targetRaySpace, referenceSpace);
            return pose ? toBoardPose(_matrix.fromArray(pose.transform.matrix).clone()) : null;
        };

        const head = toBoardPose(camera.matrixWorld);
        const scale = 1 / board.getWorldScale(_scale).x;
        publishAvatar(head, handPose(leftController ?? leftHand), handPose(rightController ?? rightHand), scale);
    });

    return null;
}

// Eases one avatar part (group) towards a received [px,py,pz, qx,qy,qz,qw] pose at avatar scale `s`
function followPart(part, pose, s, follow) {
    if (pose == null) {
        part.visible = false;
        return;
    }
    _position.fromArray(pose, 0);
    _quaternion.fromArray(pose, 3);
    if (!part.visible) { part.position.copy(_position); part.quaternion.copy(_quaternion); } // no glide on appear
    part.visible = true;
    part.position.lerp(_position, follow);
    part.quaternion.slerp(_quaternion, follow);
    part.scale.setScalar(s);
}

// Another headset user: head with visor, two hands, name tag above the head
function RemoteAvatar({ user }) {
    const rootRef = useRef();
    const headRef = useRef();
    const leftRef = useRef();
    const rightRef = useRef();
    const labelRef = useRef();

    useFrame((_state, delta) => {
        const avatar = remoteAvatars.get(user.clientId);
        rootRef.current.visible = avatar != null;
        if (avatar == null) return;
        const follow = 1 - Math.exp(-delta * FOLLOW_RATE);
        followPart(headRef.current, avatar.h, avatar.s, follow);
        followPart(leftRef.current, avatar.l, avatar.s, follow);
        followPart(rightRef.current, avatar.r, avatar.s, follow);
        // name tag: above the head, upright (not rotated with it)
        const label = labelRef.current;
        label.position.copy(headRef.current.position);
        label.position.y += LABEL_OFFSET * avatar.s;
        label.scale.setScalar(avatar.s);
    });

    const material = <meshStandardMaterial color={user.color} flatShading roughness={0.8} />;
    return (
        <group ref={rootRef} visible={false}>
            <group ref={headRef} visible={false}>
                <mesh raycast={noRaycast}>
                    <icosahedronGeometry args={[HEAD_RADIUS, 0]} />
                    {material}
                </mesh>
                {/* visor on the face side (-Z = where the head looks) */}
                <mesh position={[0, 0.01, -HEAD_RADIUS * 0.85]} raycast={noRaycast}>
                    <boxGeometry args={VISOR_SIZE} />
                    <meshStandardMaterial color="#151827" roughness={0.4} />
                </mesh>
            </group>
            <group ref={leftRef} visible={false}>
                <mesh raycast={noRaycast}>
                    <boxGeometry args={HAND_SIZE} />
                    {material}
                </mesh>
            </group>
            <group ref={rightRef} visible={false}>
                <mesh raycast={noRaycast}>
                    <boxGeometry args={HAND_SIZE} />
                    {material}
                </mesh>
            </group>
            <group ref={labelRef}>
                <NameLabel name={user.name} color={user.color} size={LABEL_SIZE} />
            </group>
        </group>
    );
}
