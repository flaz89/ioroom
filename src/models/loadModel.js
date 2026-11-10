import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';

/*
* Loads the GLB of a catalog model ONCE (cache by file key, shared by every copy in the scene) and turns it
* into what a single <mesh> draws (plan KTD11, KTD12):
* - glTF splits a mesh with N materials into N primitives, which GLTFLoader returns as N meshes: they are
*   merged into ONE geometry with a group per material, plus the materials array in the same order (named
*   as in the GLB: variants refer to them by name). Notes, ruler, grab and outline keep seeing one mesh.
* - the node transforms are baked into the geometry (a GLB exported with a rotated node stands upright);
* - the origin goes to the center of the base (x / z centered, bottom at y = 0), like a placed object;
* - a BVH (three-mesh-bvh, plan U7) is built once on the shared geometry (`geometry.boundsTree`): a tree of
*   boxes, each split in two down to ~10 triangles, so a ray or a fingertip skips every box it cannot reach
*   instead of testing every triangle (hover, XR rays, drag footprint, ruler, notes: SingleObject.jsx uses
*   acceleratedRaycast; meshSpherecast.js its closest point query). `indirect`: the tree keeps its own
*   triangle order and leaves the geometry's index untouched, so the material groups stay valid.
* Draco: decoder served by the app from public/draco/ (copied from three's examples/jsm/libs/draco/gltf).
* Geometry and materials are never disposed (the cache lives as long as the page).
*/
let loader = null;
function gltfLoader() {
    if (loader == null) {
        const draco = new DRACOLoader().setDecoderPath(`${import.meta.env?.BASE_URL ?? '/'}draco/`);
        loader = new GLTFLoader().setDRACOLoader(draco);
    }
    return loader;
}

/*
* MOVING PARTS (sliding backrests, armrests): a node named `move_<name>` with a `slide` custom property
* (Blender: Object Properties > Custom Properties, Float Array of 3, meters in BLENDER axes; exported as
* glTF extras, which GLTFLoader puts in userData) is kept apart from the body: { name, slide, geometry,
* materials }, slide converted to three.js axes (Blender x, y, z -> x, z, -y). The file holds the part's
* REST position; `slide` is where it goes when moved. A `move_` node without a valid slide is body.
*/
export const MOVE_PREFIX = 'move_';
const moverOf = (object) => {
    for (let node = object; node; node = node.parent) {
        if (node.name.startsWith(MOVE_PREFIX)) return validSlide(node.userData.slide) ? node : null;
    }
    return null;
};
export const validSlide = (slide) => Array.isArray(slide) && slide.length === 3 && slide.every(Number.isFinite);

/*
* Every mesh under `root` as one geometry with a group per part and the parts' materials, centered on its
* base (body and moving parts at rest together, all shifted the same). Attributes missing from some part
* are dropped (merging needs the same set everywhere).
*/
export function mergeParts(root) {
    root.updateMatrixWorld(true);
    const body = [];
    const movers = new Map(); // move_ node -> its meshes
    root.traverse((object) => {
        if (!object.isMesh) return;
        const mover = moverOf(object);
        if (mover == null) body.push(object);
        else movers.set(mover, [...(movers.get(mover) ?? []), object]);
    });
    if (body.length === 0) throw new Error('The GLB has no mesh');
    const all = [{ meshes: body }, ...[...movers].map(([node, meshes]) => ({ node, meshes }))]
        .map((entry) => ({ ...entry, geometry: mergeMeshes(entry.meshes) }));
    const box = new THREE.Box3();
    for (const { geometry } of all) {
        geometry.computeBoundingBox();
        box.union(geometry.boundingBox);
    }
    for (const { geometry } of all) {
        geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
    }
    const materials = (meshes) => meshes.map((mesh) => mesh.material);
    const [main, ...parts] = all;
    return {
        geometry: main.geometry,
        materials: materials(main.meshes),
        parts: parts.map(({ node, meshes, geometry }) => {
            const [x, y, z] = node.userData.slide;
            return { name: node.name, slide: [x, z, -y], geometry, materials: materials(meshes) };
        })
    };
}

// Material names of a merged model, body then moving parts, once each (variants change materials by name)
export const modelMaterialNames = (mesh) => [...new Set([mesh.materials, ...mesh.parts.map((part) => part.materials)].flat().map((material) => material.name))];

// The meshes as one geometry in root space, a group per mesh (= per material)
function mergeMeshes(parts) {
    let geometries = parts.map((part) => {
        const geometry = part.geometry.clone().applyMatrix4(part.matrixWorld);
        geometry.morphAttributes = {};
        return geometry;
    });
    const common = Object.keys(geometries[0].attributes).filter((name) => geometries.every((g) => g.attributes[name]));
    for (const geometry of geometries) {
        for (const name of Object.keys(geometry.attributes)) if (!common.includes(name)) geometry.deleteAttribute(name);
    }
    if (geometries.some((geometry) => geometry.index == null)) {
        geometries = geometries.map((geometry) => (geometry.index ? geometry.toNonIndexed() : geometry));
    }
    return mergeGeometries(geometries, true);
}

/*
* The left/right mirror of a merged geometry (modular sofas: one GLB for both sides), cached per geometry.
* Mirrored in the geometry, not with a negative scale on the mesh: notes, ruler anchors and the BVH stay in
* plain mesh space and the object's transform (drags, yawOf) never sees a mirror. X flipped (origin is the
* base center, so the footprint stays put), triangle winding swapped to keep the faces outward.
*/
const mirrors = new WeakMap();
export function mirroredGeometry(geometry) {
    if (!mirrors.has(geometry)) {
        const mirror = geometry.clone().applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
        if (mirror.index == null) mirror.setIndex([...Array(mirror.attributes.position.count).keys()]);
        const index = mirror.index;
        for (let i = 0; i < index.count; i += 3) {
            const b = index.getX(i + 1);
            index.setX(i + 1, index.getX(i + 2));
            index.setX(i + 2, b);
        }
        mirror.computeBoundingBox();
        mirror.computeBoundingSphere();
        mirror.boundsTree = new MeshBVH(mirror, { indirect: true });
        mirrors.set(geometry, mirror);
    }
    return mirrors.get(geometry);
}

// A GLB file's content (ArrayBuffer) -> the loader's gltf (upload checks: models/inspectGlb.js)
export const parseGlb = (buffer) => gltfLoader().parseAsync(buffer, '');

const pending = new Map(); // GLB url -> Promise
const loaded = new Map();  // GLB url -> { geometry, materials, parts }

// The merged mesh of the GLB at `url` if already loaded (synchronous: a new copy of a loaded model never flickers)
export const peekModel = (url) => loaded.get(url);

// Loads the GLB at `url` (once); resolves with { geometry, materials }. A failed load is retried next call.
export function loadModel(url) {
    if (!pending.has(url)) {
        pending.set(url, gltfLoader().loadAsync(url).then((gltf) => {
            const mesh = mergeParts(gltf.scene);
            loaded.set(url, mesh);
            return mesh;
        }).catch((error) => {
            pending.delete(url);
            throw error;
        }));
    }
    return pending.get(url);
}
