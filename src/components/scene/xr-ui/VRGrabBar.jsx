import { useRef } from 'react';
import { Quaternion, Vector3 } from 'three';
import { useThree } from '@react-three/fiber';

/*
* Grab bar under an in-VR panel, like the windows of the Quest: grab it (pinch with the hand ray or the
* controller trigger, or a near pinch / grip) and the whole panel (`targetRef`, a world-space group)
* follows the hand, always turned to face the user; released, it stays there.
*
* How it follows: on press the panel is attached RIGIDLY to the pointer (its offset is stored in the
* pointer's own frame), then on every move of that (captured) pointer: position = pointer position +
* that offset turned by the pointer's current rotation (like a panel on the tip of a stick), and the
* panel looks at the eyes. A few vector operations per move: no cost worth measuring.
* No React state while dragging (a re-render mid-drag is wasted work): the highlight is imperative.
* Every pointer can grab it (it is aimed at on purpose). The visible pill is small; the invisible hit
* area around it is larger, so it is easy to catch. `y`: center of the bar in panel space.
*/
const BAR = [0.07, 0.008];      // meters: visible pill
const HIT = [0.14, 0.035];      // meters: grab area
const COLOR = '#c8cde6';
const COLOR_ACTIVE = '#ffffff';
const _eye = new Vector3();
const noRaycast = () => null;

export default function VRGrabBar({ targetRef, y }) {
    const pillRef = useRef();
    const getThree = useThree((state) => state.get);
    const ui = useRef({ hovered: false, grabbed: false });
    // active drag: { pointerId, offset (panel - pointer, in the pointer's frame at press time) }
    const drag = useRef(null);

    // Highlight while pointed at or held (imperative: no re-render)
    const highlight = (patch) => {
        Object.assign(ui.current, patch);
        const pill = pillRef.current;
        if (pill == null) return;
        const on = ui.current.hovered || ui.current.grabbed;
        pill.scale.setScalar(on ? 1.25 : 1);
        pill.material.color.set(on ? COLOR_ACTIVE : COLOR);
        pill.material.opacity = on ? 0.95 : 0.6;
    };

    const onPointerDown = (event) => {
        event.stopPropagation();
        const panel = targetRef.current;
        if (panel == null || drag.current != null || event.pointerPosition == null) return;
        event.target.setPointerCapture(event.pointerId);
        const toPointerFrame = new Quaternion().copy(event.pointerQuaternion).invert();
        drag.current = {
            pointerId: event.pointerId,
            offset: panel.position.clone().sub(event.pointerPosition).applyQuaternion(toPointerFrame)
        };
        highlight({ grabbed: true });
    };

    const onPointerMove = (event) => {
        const current = drag.current;
        const panel = targetRef.current;
        if (current == null || event.pointerId !== current.pointerId || panel == null) return;
        event.stopPropagation();
        panel.position.copy(current.offset).applyQuaternion(event.pointerQuaternion).add(event.pointerPosition);
        getThree().camera.getWorldPosition(_eye);
        panel.lookAt(_eye); // same orientation rule as placeInFrontOfUser
    };

    const end = (event) => {
        if (drag.current == null || event.pointerId !== drag.current.pointerId) return;
        event.stopPropagation();
        event.target.releasePointerCapture?.(event.pointerId);
        drag.current = null;
        highlight({ grabbed: false });
    };

    return (
        <group position={[0, y, 0.001]}>
            <mesh
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={end}
                onPointerCancel={end}
                onPointerEnter={() => highlight({ hovered: true })}
                onPointerLeave={() => highlight({ hovered: false })}
            >
                <planeGeometry args={HIT} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <mesh ref={pillRef} raycast={noRaycast} rotation-z={Math.PI / 2}>
                <capsuleGeometry args={[BAR[1] / 2, BAR[0] - BAR[1], 4, 12]} />
                <meshBasicMaterial color={COLOR} transparent opacity={0.6} toneMapped={false} />
            </mesh>
        </group>
    );
}
