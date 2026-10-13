import { useLayoutEffect, useMemo, useRef } from 'react';
import { BackSide, Color } from 'three';
import { useThree } from '@react-three/fiber';
import { Outlines } from '@react-three/drei';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraProjectionMatrix, modelViewMatrix, normalLocal, normalize, positionLocal, screenSize, uniform, vec4 } from 'three/tsl';

/*
* Selection outline that works on both renderers. Place it as a child of the <mesh> to outline.
* - WebGL  -> drei <Outlines> (GLSL inverted hull).
* - WebGPU -> the same inverted-hull technique rewritten in TSL, so it looks identical:
*   the hull is pushed out along the clip-space normal by a constant number of screen pixels.
*/
export default function SelectionOutline({ color = 'orange', thickness = 2 }) {
    const isWebGPU = useThree((state) => state.gl.isWebGPURenderer === true);

    if (!isWebGPU) {
        // angle={0}: use the parent's own normals; screenspace={false}: drei's naming for "thickness in pixels"
        return <Outlines thickness={thickness} color={color} screenspace={false} opacity={1} transparent={false} angle={0} />;
    }
    return <NodeOutline color={color} thickness={thickness} />;
}

// Inverted-hull material: back faces pushed out along the clip-space normal by `thickness` pixels
function createOutlineMaterial(color, thickness) {
    const material = new MeshBasicNodeMaterial({ side: BackSide });
    const clipPosition = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionLocal, 1));
    const clipNormal = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(normalLocal, 0));
    // Same formula as drei's Outlines: pixel offset converted to clip space (multiplied by w)
    const offset = normalize(clipNormal.xy).mul(uniform(thickness)).div(screenSize).mul(clipPosition.w).mul(2);
    material.vertexNode = vec4(clipPosition.xy.add(offset), clipPosition.zw);
    material.colorNode = uniform(new Color(color));
    return material;
}

function NodeOutline({ color, thickness }) {
    const meshRef = useRef();

    // ponytail: rebuilt (and recompiled) when color/thickness change; switch to updatable uniforms if they get animated
    const material = useMemo(() => createOutlineMaterial(color, thickness), [color, thickness]);
    useLayoutEffect(() => () => material.dispose(), [material]);

    // Share the parent mesh geometry (not owned here, so never disposed here)
    useLayoutEffect(() => {
        meshRef.current.geometry = meshRef.current.parent.geometry;
    });

    // raycast disabled: the hull must never steal clicks from the outlined object
    return <mesh ref={meshRef} material={material} raycast={() => null} />;
}
