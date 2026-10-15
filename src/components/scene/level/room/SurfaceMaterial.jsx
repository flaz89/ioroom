import { Suspense, useEffect, useMemo } from 'react';
import { RepeatWrapping, SRGBColorSpace } from 'three';
import { useTexture } from '@react-three/drei';
import { useStore } from '../../../../store/appStore';
import { PLAIN, findSurfaceMaterial, textureUrl } from './surfaceMaterials';

/*
* Material of one room surface (child of its mesh): the material picked for `surfaceId` in the store,
* or the plain color. `size` = [width, height] in meters of the surface's UV square (the face the room
* sees), so texture tiles keep their real size. While a texture set loads, the plain material shows.
* Built-in MeshStandardMaterial only: works on WebGPU and WebGL (XR).
*/
export default function SurfaceMaterial({ surfaceId, size, color }) {
    const materialId = useStore((state) => state.surfaces[surfaceId] ?? PLAIN);
    const plain = <meshStandardMaterial color={color} />;
    if (materialId === PLAIN) return plain;
    return (
        <Suspense fallback={plain}>
            <TexturedMaterial material={findSurfaceMaterial(materialId)} size={size} />
        </Suspense>
    );
}

function TexturedMaterial({ material, size }) {
    const [width, height] = size;
    // Loaded once per set and cached by drei; each surface tiles its own clones (repeat differs)
    const loaded = useTexture([textureUrl(material.id, 'diff'), textureUrl(material.id, 'nor_gl'), textureUrl(material.id, 'rough')]);
    const [map, normalMap, roughnessMap] = useMemo(() => loaded.map((texture, index) => {
        const tiled = texture.clone();
        tiled.wrapS = tiled.wrapT = RepeatWrapping;
        tiled.repeat.set(width / material.size, height / material.size);
        tiled.anisotropy = 8; // floors and walls are mostly seen at grazing angles
        if (index === 0) tiled.colorSpace = SRGBColorSpace; // color map; normal/roughness stay linear data
        tiled.needsUpdate = true;
        return tiled;
    }), [loaded, width, height, material.size]);
    useEffect(() => () => [map, normalMap, roughnessMap].forEach((texture) => texture.dispose()), [map, normalMap, roughnessMap]);

    return <meshStandardMaterial map={map} normalMap={normalMap} roughnessMap={roughnessMap} />;
}
