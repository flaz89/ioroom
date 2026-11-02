import * as THREE from 'three';
import { useEffect, useState } from 'react';
import { loadModel, peekModel } from './loadModel';
import { modelFileUrl } from './modelsApi';
import { materialChanges, variantKey, variantOf } from './variants';

/*
* What a catalog object draws (plan U3, KTD4, KTD12): { geometry, materials, loaded } for `model` (record
* from catalog.js, null if unknown) with the variant `variantId`. No Suspense: while the GLB loads, or for
* an unknown model, a placeholder box of the record's size (0.5 m without a record) on the base, so the
* same <mesh> stays mounted and only swaps geometry and materials.
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

const variantMaterials = new Map(); // variantKey -> materials
// The GLB's materials with the variant's changes: untouched ones are the GLB's own, changed ones are copies
function materialsOf(model, variant, base) {
    const key = variantKey(model, variant);
    if (!variantMaterials.has(key)) {
        const changes = materialChanges(base.map((material) => material.name), variant);
        variantMaterials.set(key, base.map((material, i) => {
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
    return variantMaterials.get(key);
}

export function useModelMesh(model, variantId) {
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

    if (mesh == null) return { geometry: placeholderGeometry(model?.size), materials: PLACEHOLDER, loaded: false };
    return { geometry: mesh.geometry, materials: materialsOf(model, variantOf(model, variantId), mesh.materials), loaded: true };
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
