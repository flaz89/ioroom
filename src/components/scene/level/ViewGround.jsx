import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { setViewGroundProbe } from './viewGroundProbe';

const _ray = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const _inverse = new THREE.Matrix4();
const _hit = new THREE.Vector3();
const _floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// Scene side of viewGroundProbe.js: the ray through the center of the view, into board space, on the y = 0 plane
export default function ViewGround() {
    const anchorRef = useRef(); // child of the board: its parent is the board root
    const camera = useThree((state) => state.camera);
    useEffect(() => {
        setViewGroundProbe(() => {
            const board = anchorRef.current?.parent;
            if (board == null) return null;
            _ray.setFromCamera(_center, camera);
            _ray.ray.applyMatrix4(_inverse.copy(board.matrixWorld).invert());
            return _ray.ray.intersectPlane(_floor, _hit) ? [_hit.x, _hit.z] : null;
        });
        return () => setViewGroundProbe(null);
    }, [camera]);
    return <group ref={anchorRef} />;
}
