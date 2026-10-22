import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { PMREMGenerator as WebGLPMREMGenerator } from 'three';
import { PMREMGenerator as WebGPUPMREMGenerator } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/*
* Image-based lighting for the whole scene (scene.environment): without it a MeshStandardMaterial gets
* specular light only from the sun, so glossy dark materials (black marble) render almost black and every
* surface looks flat.
*
* EFFICIENCY: RoomEnvironment is a procedural studio room (no HDR file to download), pre-filtered once
* into a PMREM texture when the renderer is created: one texture, no per-frame cost. Works on both
* backends: WebGPURenderer needs the PMREMGenerator from three/webgpu, WebGLRenderer (XR) the classic one.
* A new backend means a new canvas and renderer (Scene.jsx), so this re-runs and disposes the old texture.
* ponytail: fixed studio look, it does not "see" the real room; light probes / GI come with the quality presets.
*/
export default function SceneEnvironment() {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);

    useLayoutEffect(() => {
        const pmrem = gl.isWebGPURenderer ? new WebGPUPMREMGenerator(gl) : new WebGLPMREMGenerator(gl);
        const room = new RoomEnvironment();
        const envMap = pmrem.fromScene(room, 0.04).texture; // 0.04: slight blur, standard for RoomEnvironment
        room.dispose();
        pmrem.dispose();
        scene.environment = envMap; // its intensity follows the sun: components/light/Light.jsx
        return () => {
            if (scene.environment === envMap) scene.environment = null;
            envMap.dispose();
        };
    }, [gl, scene]);

    return null;
}
