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
* Every mesh under `root` as one geometry with a group per part and the parts' materials, centered on its
* base. Attributes missing from some part are dropped (merging needs the same set everywhere).
*/
export function mergeParts(root) {
    root.updateMatrixWorld(true);
    const parts = [];
    root.traverse((object) => { if (object.isMesh) parts.push(object); });
    if (parts.length === 0) throw new Error('The GLB has no mesh');
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
    const geometry = mergeGeometries(geometries, true);
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    geometry.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
    return { geometry, materials: parts.map((part) => part.material) };
}

const pending = new Map(); // GLB url -> Promise
const loaded = new Map();  // GLB url -> { geometry, materials }

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
