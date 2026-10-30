import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { BackSide, BufferAttribute, Color, Mesh, MeshBasicMaterial, PMREMGenerator as WebGLPMREMGenerator, Scene, SphereGeometry } from 'three';
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
* XR (`xr`): a soft SKY GRADIENT instead (light above, horizon, darker ground: the XR hemisphere fill of
* Light.jsx, no GI there). The studio's bright light panels showed on glossy floors as a light streak even where
* the room should be in shade (29/10 on the Quest); a gradient leaves a plain sheen that grows towards grazing
* angles, like a real floor.
* ponytail: fixed looks, they do not "see" the real room; light probes / GI come with the quality presets.
*/
const XR_SKY = '#f2f5ff';     // calibration knobs: tune on the headset (close to Light.jsx's XR_SKY / XR_GROUND)
const XR_HORIZON = '#d6d3ce';
const XR_GROUND = '#8a867f';

// A big inward-facing sphere colored from the ground (bottom) through the horizon to the sky (top)
function gradientScene() {
    const geometry = new SphereGeometry(10, 32, 16);
    const [sky, horizon, ground] = [XR_SKY, XR_HORIZON, XR_GROUND].map((hex) => new Color(hex));
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const color = new Color();
    for (let i = 0; i < position.count; i++) {
        const y = position.getY(i) / 10; // -1 (down) .. 1 (up)
        color.copy(horizon).lerp(y >= 0 ? sky : ground, Math.abs(y));
        color.toArray(colors, i * 3);
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const scene = new Scene();
    scene.add(new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide })));
    return { scene, dispose: () => { geometry.dispose(); scene.children[0].material.dispose(); } };
}

export default function SceneEnvironment({ xr = false }) {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);

    useLayoutEffect(() => {
        const pmrem = gl.isWebGPURenderer ? new WebGPUPMREMGenerator(gl) : new WebGLPMREMGenerator(gl);
        let envMap;
        if (xr) {
            const gradient = gradientScene();
            envMap = pmrem.fromScene(gradient.scene, 0.04).texture;
            gradient.dispose();
        } else {
            const room = new RoomEnvironment();
            envMap = pmrem.fromScene(room, 0.04).texture; // 0.04: slight blur, standard for RoomEnvironment
            room.dispose();
        }
        pmrem.dispose();
        scene.environment = envMap; // its intensity follows the sun: components/light/Light.jsx
        return () => {
            if (scene.environment === envMap) scene.environment = null;
            envMap.dispose();
        };
    }, [gl, scene, xr]);

    return null;
}
