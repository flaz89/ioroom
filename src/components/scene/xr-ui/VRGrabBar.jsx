import { useRef, useState } from 'react';
import { Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import { useHandle } from '@react-three/handle';

/*
* Grab bar under an in-VR panel, like the windows of the Quest: grab it (pinch with the hand ray or the
* controller trigger, or a near pinch / grip) and the whole panel (`targetRef`, a world-space group)
* follows the hand, turning to keep facing the user. Released, it stays there.
* Every pointer can grab it (it is aimed at on purpose). The visible pill is small; the invisible hit
* area around it is larger, so it is easy to catch. `y`: center of the bar in the panel's space.
*/
const BAR = [0.07, 0.008];      // meters: visible pill
const HIT = [0.14, 0.035];      // meters: grab area
const _eye = new Vector3();
const noRaycast = () => null;

export default function VRGrabBar({ targetRef, y }) {
    const barRef = useRef();
    const getThree = useThree((state) => state.get);
    const [hovered, setHovered] = useState(false);
    const [grabbed, setGrabbed] = useState(false);

    useHandle(targetRef, {
        handle: barRef,
        translate: true,
        rotate: false,
        scale: false,
        multitouch: false,
        // the panel follows the hand and keeps facing the eyes (same orientation rule as placeInFrontOfUser)
        apply: (state, target) => {
            target.position.copy(state.current.position);
            getThree().camera.getWorldPosition(_eye);
            target.lookAt(_eye);
            setGrabbed(!state.last);
        }
    });

    const highlighted = hovered || grabbed;
    return (
        <group position={[0, y, 0.001]}>
            <mesh
                ref={barRef}
                onPointerEnter={() => setHovered(true)}
                onPointerLeave={() => setHovered(false)}
            >
                <planeGeometry args={HIT} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <mesh raycast={noRaycast} rotation-z={Math.PI / 2} scale={highlighted ? 1.25 : 1}>
                <capsuleGeometry args={[BAR[1] / 2, BAR[0] - BAR[1], 4, 12]} />
                <meshBasicMaterial color={highlighted ? '#ffffff' : '#c8cde6'} transparent opacity={highlighted ? 0.95 : 0.6} toneMapped={false} />
            </mesh>
        </group>
    );
}
