import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { setSurfacePicker } from './surfacePicker';

const _ndc = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();

/*
* Scene side of material drag & drop (desktop/mobile, mounted inside the Board): registers the picker
* of surfacePicker.js. A screen point maps to the room surface under it (meshes with userData.surfaceId,
* Room.jsx) only if the canvas itself is there (not a panel on top of it) and no object stands in front
* (object meshes: userData.objectId). Notes, gizmos and invisible helpers are looked through.
*/
export default function MaterialDropTarget() {
    const anchorRef = useRef(); // child of the board: its parent is the board root
    const gl = useThree((state) => state.gl);
    const camera = useThree((state) => state.camera);

    useEffect(() => {
        setSurfacePicker((clientX, clientY) => {
            const board = anchorRef.current?.parent;
            if (board == null || document.elementFromPoint(clientX, clientY) !== gl.domElement) return null;
            const rect = gl.domElement.getBoundingClientRect();
            _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
            _raycaster.setFromCamera(_ndc, camera);
            for (const hit of _raycaster.intersectObject(board, true)) {
                const object = hit.object;
                if (!object.isMesh || hit.face == null || !object.visible || object.isLineSegments2 || object.userData.isNote) continue;
                if (object.userData.surfaceId != null) return object.userData.surfaceId;
                if (object.userData.objectId != null) return null; // an object in front of the surface
            }
            return null;
        });
        return () => setSurfacePicker(null);
    }, [gl, camera]);

    return <group ref={anchorRef} />;
}
