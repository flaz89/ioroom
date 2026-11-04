import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { setViewGroundProbe } from './viewGroundProbe';

const _ray = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const _ndc = new THREE.Vector2();
const _inverse = new THREE.Matrix4();
const _hit = new THREE.Vector3();
const _floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/*
* Scene side of viewGroundProbe.js: the ray through the center of the view (or through a screen point, only
* where the canvas itself is: not under a panel), into board space, on the y = 0 plane.
* ponytail: y = 0 plane, a raised floor shifts the point a little; raycast the floors if that shows.
*/
export default function ViewGround() {
    const anchorRef = useRef(); // child of the board: its parent is the board root
    const camera = useThree((state) => state.camera);
    const gl = useThree((state) => state.gl);
    useEffect(() => {
        setViewGroundProbe((clientX, clientY) => {
            const board = anchorRef.current?.parent;
            if (board == null) return null;
            if (clientX == null) _ndc.copy(_center);
            else {
                if (document.elementFromPoint(clientX, clientY) !== gl.domElement) return null;
                const rect = gl.domElement.getBoundingClientRect();
                _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
            }
            _ray.setFromCamera(_ndc, camera);
            _ray.ray.applyMatrix4(_inverse.copy(board.matrixWorld).invert());
            return _ray.ray.intersectPlane(_floor, _hit) ? [_hit.x, _hit.z] : null;
        });
        return () => setViewGroundProbe(null);
    }, [camera, gl]);
    return <group ref={anchorRef} />;
}
