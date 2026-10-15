import { Suspense } from 'react';
import { MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three';
import { useTexture } from '@react-three/drei';
import { useStore } from '../../../../store/appStore';
import { PLAIN_ID, findMaterial } from '../../../../materials/library';

const DROP_TINT = '#ff9a1a';    // selection orange: the face a dragged material would land on
const DROP_TINT_STRENGTH = 0.18;
const ANISOTROPY = 8;           // floors and walls are mostly seen at grazing angles

/*
* One room face: a mesh with the material saved for `surfaceId` (store `surfaces`), or the plain `color`.
* While a material is dragged over this face (store `materialDrag`, ui/materials-panel/) it previews that
* material with an orange tint. While a texture set loads, the plain material shows. Other props
* (geometry, userData, shadows) go to the mesh.
*
* EFFICIENCY: the room geometry has world-space UVs in meters (roomGeometry.js), so every face uses the
* same texture repeat (1 / tileSize). One shared MeshStandardMaterial per material (and per tint) serves
* every face that uses it: textures are loaded once (drei cache) and never cloned, shaders and uniforms
* are shared. The shared material is set through the mesh `material` prop (not as a JSX child), so React
* never owns, detaches or disposes it. Built-in MeshStandardMaterial only: WebGPU and WebGL (XR).
*/
export default function SurfaceMesh({ surfaceId, color, ...meshProps }) {
    const savedId = useStore((state) => state.surfaces[surfaceId] ?? PLAIN_ID);
    const previewId = useStore((state) => (state.materialDrag?.surfaceId === surfaceId ? state.materialDrag.materialId : null));
    const material = findMaterial(previewId ?? savedId);
    const tinted = previewId != null;
    const plain = <mesh {...meshProps} material={plainMaterial(color, tinted)} />;
    if (material.maps == null) return plain;
    return (
        <Suspense fallback={plain}>
            <TexturedMesh material={material} tinted={tinted} meshProps={meshProps} />
        </Suspense>
    );
}

function TexturedMesh({ material, tinted, meshProps }) {
    const textures = useTexture([material.maps.color, material.maps.normal, material.maps.roughness]);
    return <mesh {...meshProps} material={texturedMaterial(material, textures, tinted)} />;
}

// SHARED MATERIALS ------------------------------------------------------------------------------
// ponytail: kept for the whole session (a few materials); evict / dispose when the library comes from
// the DB and grows large.
const materials = new Map(); // cache key -> MeshStandardMaterial

const tint = (tinted) => (tinted ? { emissive: DROP_TINT, emissiveIntensity: DROP_TINT_STRENGTH } : {});

function plainMaterial(color, tinted) {
    const key = `plain|${color}|${tinted}`;
    if (!materials.has(key)) materials.set(key, new MeshStandardMaterial({ color, ...tint(tinted) }));
    return materials.get(key);
}

function texturedMaterial(material, [map, normalMap, roughnessMap], tinted) {
    const key = `${material.id}|${tinted}`;
    if (!materials.has(key)) {
        // drei's cached textures, configured in place: every user of this set wants the same tiling
        for (const texture of [map, normalMap, roughnessMap]) {
            texture.wrapS = texture.wrapT = RepeatWrapping;
            texture.repeat.set(1 / material.tileSize, 1 / material.tileSize); // UVs are meters
            texture.anisotropy = ANISOTROPY;
            texture.needsUpdate = true;
        }
        map.colorSpace = SRGBColorSpace; // color map; normal/roughness stay linear data
        materials.set(key, new MeshStandardMaterial({ map, normalMap, roughnessMap, ...tint(tinted) }));
    }
    return materials.get(key);
}
