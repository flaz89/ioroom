import * as THREE from 'three';
import { useEffect, useState } from 'react';
import { loadModel, mirroredGeometry, peekModel } from './loadModel';
import { modelFileUrl } from './modelsApi';
import { materialChanges, variantKey, variantOf } from './variants';

/*
* What a catalog object draws (plan U3, KTD4, KTD12): { geometry, materials, loaded } for `model` (record
* from catalog.js, null if unknown) with the variant `variantId`. No Suspense: while the GLB loads, or for
* an unknown model, a placeholder box of the record's size (0.5 m without a record) on the base, so the
* same <mesh> stays mounted and only swaps geometry and materials.
* parts: the moving parts (loadModel.js), each { name, slide, geometry, materials }, [] for most pieces.
* Everything returned is SHARED (every copy of a model / variant) and never disposed: pass it with the
* geometry / material props and dispose={null}, never mutate it (hover: tintedMaterials).
*/
const FALLBACK_SIZE = [0.5, 0.5, 0.5];
const PLACEHOLDER = [new THREE.MeshStandardMaterial({ color: '#d0d0d0', roughness: 0.9 })];

const placeholders = new Map(); // "w,h,d" -> box geometry standing on y = 0
function placeholderGeometry(size = FALLBACK_SIZE) {
    const key = size.join(',');
    if (!placeholders.has(key)) {
        const box = new THREE.BoxGeometry(...size).translate(0, size[1] / 2, 0);
        // one group for all the faces: BoxGeometry has a group (material index) per face, and with the
        // one-material array of the placeholder only the first face was drawn
        box.clearGroups();
        box.addGroup(0, Infinity, 0);
        placeholders.set(key, box);
    }
    return placeholders.get(key);
}

const textureLoader = new THREE.TextureLoader();
const textures = new Map(); // url -> texture
// Variant color texture, loaded once; glTF conventions (flipY false, sRGB) and the sampler of the map it replaces
function variantTexture(url, replaced) {
    if (!textures.has(url)) {
        const texture = textureLoader.load(url);
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        if (replaced) {
            for (const key of ['wrapS', 'wrapT', 'channel', 'anisotropy', 'rotation']) texture[key] = replaced[key];
            for (const key of ['offset', 'repeat', 'center']) texture[key].copy(replaced[key]);
        }
        textures.set(url, texture);
    }
    return textures.get(url);
}

const variantMaterials = new WeakMap(); // GLB materials array (body or a moving part) -> Map(variantKey -> materials)
// The GLB's materials with the variant's changes: untouched ones are the GLB's own, changed ones are copies
function materialsOf(model, variant, base) {
    const key = variantKey(model, variant);
    if (!variantMaterials.has(base)) variantMaterials.set(base, new Map());
    const byVariant = variantMaterials.get(base);
    if (!byVariant.has(key)) {
        const changes = materialChanges(base.map((material) => material.name), variant);
        byVariant.set(key, base.map((material, i) => {
            const change = changes[i];
            if (change == null) return material;
            const copy = material.clone();
            if (change.tint) copy.color.multiply(new THREE.Color(change.tint));
            if (change.map) {
                copy.map = variantTexture(modelFileUrl(change.map), material.map);
                copy.needsUpdate = true; // a material compiled without a map ignores one assigned later
            }
            return copy;
        }));
    }
    return byVariant.get(key);
}

const NO_PARTS = [];
const partLists = new WeakMap(); // body materials of a variant -> Map(mirrored -> parts), stable for React
// The moving parts (loadModel.js) with the variant's materials; mirrored = geometry mirrored and slide x flipped
function partsOf(mesh, model, variant, mirrored, bodyMaterials) {
    if (mesh.parts.length === 0) return NO_PARTS;
    if (!partLists.has(bodyMaterials)) partLists.set(bodyMaterials, new Map());
    const byMirror = partLists.get(bodyMaterials);
    if (!byMirror.has(mirrored)) {
        byMirror.set(mirrored, mesh.parts.map((part) => ({
            name: part.name,
            slide: mirrored ? [-part.slide[0], part.slide[1], part.slide[2]] : part.slide,
            geometry: mirrored ? mirroredGeometry(part.geometry) : part.geometry,
            materials: materialsOf(model, variant, part.materials)
        })));
    }
    return byMirror.get(mirrored);
}

// mirrored: the left/right mirror of the piece (instance field, loadModel.mirroredGeometry); the placeholder box is symmetric
export function useModelMesh(model, variantId, mirrored = false) {
    const url = model ? modelFileUrl(model.files.glb) : null;
    const mesh = url ? peekModel(url) : null;
    const [, setLoadedUrl] = useState(null);
    useEffect(() => {
        if (url == null || peekModel(url)) return;
        let live = true;
        loadModel(url)
            .then(() => { if (live) setLoadedUrl(url); })
            .catch((error) => console.warn('Model not loaded:', error.message));
        return () => { live = false; };
    }, [url]);

    if (mesh == null) return { geometry: placeholderGeometry(model?.size), materials: PLACEHOLDER, parts: NO_PARTS, loaded: false };
    const variant = variantOf(model, variantId);
    const materials = materialsOf(model, variant, mesh.materials);
    return {
        geometry: mirrored ? mirroredGeometry(mesh.geometry) : mesh.geometry,
        materials,
        parts: partsOf(mesh, model, variant, mirrored, materials),
        loaded: true
    };
}

const tinted = new WeakMap(); // materials -> Map("color:intensity" -> copies)
/*
* Copies of `materials` with an emissive tint (hover), cached: the shared materials are never touched.
* The glow goes through the color texture (emissiveMap = map): the texture gets brighter and tinted
* instead of being washed out by a flat glow (a flat 35% white hid dark woods and leathers).
*/
export function tintedMaterials(materials, color, intensity) {
    if (!tinted.has(materials)) tinted.set(materials, new Map());
    const byColor = tinted.get(materials);
    const key = `${color}:${intensity}`;
    if (!byColor.has(key)) {
        byColor.set(key, materials.map((material) => {
            const copy = material.clone();
            if (copy.emissive == null) return copy; // unlit GLB materials have no emissive: no tint
            copy.emissive.set(color);
            copy.emissiveIntensity = intensity;
            if (copy.map && !copy.emissiveMap) {
                copy.emissiveMap = copy.map;
                copy.needsUpdate = true;
            }
            return copy;
        }));
    }
    return byColor.get(key);
}
