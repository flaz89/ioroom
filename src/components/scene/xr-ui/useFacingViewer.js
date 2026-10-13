import { useRef, useState } from 'react';
import { Vector3 } from 'three';
import { useFrame } from '@react-three/fiber';

/*
* true while the object's front (+Z in its local space) faces the viewer's eyes.
* Used to reveal hand menus only when the user turns the palm/wrist towards the face, so a closed
* fist or a palm facing down can never press them by accident.
* Hysteresis (show/hide angles) avoids flickering around the threshold.
*/
const SHOW_DOT = Math.cos((40 * Math.PI) / 180); // appears within 40° of facing the eyes
const HIDE_DOT = Math.cos((60 * Math.PI) / 180); // disappears beyond 60°

const _normal = new Vector3();
const _toEyes = new Vector3();
const _position = new Vector3();

export function useFacingViewer(ref) {
    const [isFacing, setIsFacing] = useState(false);
    const facing = useRef(false); // mirrors the state inside the frame loop without re-renders

    useFrame(({ camera }) => {
        const object = ref.current;
        if (object == null) return;
        object.getWorldPosition(_position);
        _normal.set(0, 0, 1).transformDirection(object.matrixWorld);
        _toEyes.copy(camera.getWorldPosition(_toEyes)).sub(_position).normalize();
        const dot = _normal.dot(_toEyes);
        const next = facing.current ? dot > HIDE_DOT : dot > SHOW_DOT;
        if (next === facing.current) return;
        facing.current = next;
        setIsFacing(next); // only on changes
    });

    return isFacing;
}
