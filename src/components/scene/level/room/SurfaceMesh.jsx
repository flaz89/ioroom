import { Suspense } from 'react';
import { MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three';
import { useTexture } from '@react-three/drei';
import { TEXTURE_MAPS, useMaterial } from '../../../../materials/library';

const DROP_TINT = '#ff9a1a';    // selection orange: the face a dragged material would land on
const DROP_TINT_STRENGTH = 0.18;
const ANISOTROPY = 8;           // floors and walls are mostly seen at grazing angles

/*
* One batch of room faces sharing a material (Room.jsx merges them into one geometry: one draw call):
* the material `materialId` (or the plain `color`), with an orange tint when `tinted` (a material
* dragged from the materials panel is previewed there). While a texture set loads, the plain material
* shows. Other props (geometry, userData, shadows) go to the mesh.
*
* EFFICIENCY: the room geometry has world-space UVs in meters (roomGeometry.js), so every face uses the
* same texture repeat (1 / tileSize). One shared MeshStandardMaterial per material (and per tint) serves
* every batch that uses it: textures are loaded once (drei cache) and never cloned, shaders and uniforms
* are shared. The shared material is set through the mesh `material` prop (not as a JSX child), so React
* never owns, detaches or disposes it. Built-in MeshStandardMaterial only: WebGPU and WebGL (XR).
*/
export default function SurfaceMesh({ materialId, tinted, color, ...meshProps }) {
    const material = useMaterial(materialId);
    const plain = <mesh {...meshProps} material={plainMaterial(color, tinted)} />;
    if (material.maps == null) return plain;
    return (
        <Suspense fallback={plain}>
            <TexturedMesh material={material} tinted={tinted} meshProps={meshProps} />
        </Suspense>
    );
}

function TexturedMesh({ material, tinted, meshProps }) {
    const names = TEXTURE_MAPS.filter((name) => material.maps[name]);
    const loaded = useTexture(names.map((name) => material.maps[name]));
    const textures = Object.fromEntries(names.map((name, index) => [name, loaded[index]]));
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

// textures: { color, normal?, orm?, roughness? } (loaded, drei cache)
function texturedMaterial(material, textures, tinted) {
    // tileSize in the key: an owner edit of the real size builds a new material (and re-tiles the textures)
    const key = `${material.id}|${material.tileSize}|${tinted}`;
    if (!materials.has(key)) {
        // drei's cached textures, configured in place: every user of this set wants the same tiling
        for (const texture of Object.values(textures)) {
            texture.wrapS = texture.wrapT = RepeatWrapping;
            texture.repeat.set(1 / material.tileSize, 1 / material.tileSize); // UVs are meters
            texture.anisotropy = ANISOTROPY;
            texture.needsUpdate = true;
        }
        textures.color.colorSpace = SRGBColorSpace; // color map; normal/roughness stay linear data
        const orm = textures.orm ?? null;
        materials.set(key, new MeshStandardMaterial({
            map: textures.color,
            normalMap: textures.normal ?? null,
            // one ORM texture feeds three slots (one GPU texture): AO darkens crevices under indirect light
            aoMap: orm,
            roughnessMap: orm ?? textures.roughness ?? null,
            metalnessMap: orm,
            metalness: orm ? 1 : 0, // with a metalness map, the map (B channel) decides
            ...tint(tinted)
        }));
    }
    return materials.get(key);
}
