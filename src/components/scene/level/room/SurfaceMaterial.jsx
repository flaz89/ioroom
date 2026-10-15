import { Suspense, useEffect, useMemo } from 'react';
import { RepeatWrapping, SRGBColorSpace } from 'three';
import { useTexture } from '@react-three/drei';
import { useStore } from '../../../../store/appStore';
import { PLAIN_ID, findMaterial } from '../../../../materials/library';

const DROP_TINT = '#ff9a1a';    // selection orange: the surface a dragged material would land on
const DROP_TINT_STRENGTH = 0.18;

/*
* Material of one room surface (child of its mesh): the material saved for `surfaceId` (store
* `surfaces`), or the plain color. While a material is dragged over this surface (store `materialDrag`,
* ui/materials-panel/) it previews that material with an orange tint. `size` = [width, height] in meters
* of the surface's UV square (the face the room sees), so texture tiles keep their real size. While a
* texture set loads, the plain material shows.
* Built-in MeshStandardMaterial only: works on WebGPU and WebGL (XR).
*/
export default function SurfaceMaterial({ surfaceId, size, color }) {
    const savedId = useStore((state) => state.surfaces[surfaceId] ?? PLAIN_ID);
    const previewId = useStore((state) => (state.materialDrag?.surfaceId === surfaceId ? state.materialDrag.materialId : null));
    const material = findMaterial(previewId ?? savedId);
    const emissive = previewId != null ? { emissive: DROP_TINT, emissiveIntensity: DROP_TINT_STRENGTH } : {};
    const plain = <meshStandardMaterial color={color} {...emissive} />;
    if (material.maps == null) return plain;
    return (
        <Suspense fallback={plain}>
            <TexturedMaterial material={material} size={size} emissive={emissive} />
        </Suspense>
    );
}

function TexturedMaterial({ material, size, emissive }) {
    const [width, height] = size;
    // Loaded once per set and cached by drei; each surface tiles its own clones (repeat differs)
    const loaded = useTexture([material.maps.color, material.maps.normal, material.maps.roughness]);
    const [map, normalMap, roughnessMap] = useMemo(() => loaded.map((texture, index) => {
        const tiled = texture.clone();
        tiled.wrapS = tiled.wrapT = RepeatWrapping;
        tiled.repeat.set(width / material.tileSize, height / material.tileSize);
        tiled.anisotropy = 8; // floors and walls are mostly seen at grazing angles
        if (index === 0) tiled.colorSpace = SRGBColorSpace; // color map; normal/roughness stay linear data
        tiled.needsUpdate = true;
        return tiled;
    }), [loaded, width, height, material.tileSize]);
    useEffect(() => () => [map, normalMap, roughnessMap].forEach((texture) => texture.dispose()), [map, normalMap, roughnessMap]);

    return <meshStandardMaterial map={map} normalMap={normalMap} roughnessMap={roughnessMap} {...emissive} />;
}
