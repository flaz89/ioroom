import { MOVE_PREFIX, mergeParts, modelMaterialNames, parseGlb, validSlide } from './loadModel';

/*
* Upload checks of a GLB in the browser (plan U4, R18, KTD2): opened with the scene's own loader (Draco
* included), it must have ONE body mesh node (glTF nodes with a mesh, not three.js meshes: one per
* material), plus any number of moving parts (`move_<name>` nodes with a `slide`, loadModel.js), and at
* least one texture. Resolves with { size: [w, h, d] meters (after the node transforms, cm),
* materialNames (GLB order: variants change materials by name), mesh: { geometry, materials } (for the
* thumbnail) }; rejects with a message for the modal.
*/
export const MAX_GLB_BYTES = 30 * 1024 * 1024; // same limit as the server (server/src/models.js)

export async function inspectGlb(file) {
    if (file.size > MAX_GLB_BYTES) throw new Error('The GLB is too large (max 30 MB)');
    let gltf;
    try {
        gltf = await parseGlb(await file.arrayBuffer());
    } catch {
        throw new Error('This file is not a readable GLB');
    }
    const { json } = gltf.parser;
    const meshNodes = (json.nodes ?? []).filter((node) => node.mesh !== undefined);
    const movers = meshNodes.filter((node) => node.name?.startsWith(MOVE_PREFIX));
    const broken = movers.find((node) => !validSlide(node.extras?.slide));
    if (broken) throw new Error(`${broken.name} has no "slide" custom property (3 numbers): add it in Blender and export with Custom Properties`);
    const bodies = meshNodes.length - movers.length;
    if (bodies === 0) throw new Error('The GLB has no mesh');
    if (bodies > 1) throw new Error(`The GLB must have a single mesh (found ${bodies}): join the parts into one object before exporting (moving parts: name them move_...)`);
    if (!(json.textures?.length > 0)) throw new Error('The GLB has no texture: at least one is needed');
    const mesh = mergeParts(gltf.scene);
    // whole piece at rest: body + moving parts
    const box = mesh.parts.reduce((all, part) => all.union(part.geometry.boundingBox), mesh.geometry.boundingBox.clone());
    const size = ['x', 'y', 'z'].map((axis) => Math.round((box.max[axis] - box.min[axis]) * 100) / 100);
    return { size, materialNames: modelMaterialNames(mesh), mesh };
}
