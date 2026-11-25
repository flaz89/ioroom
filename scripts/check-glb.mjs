/*
* Checks a prepared catalog GLB against the upload rules of the app (src/models/inspectGlb.js) plus the
* catalog recipe (Draco, WebP), reading only the GLB's JSON chunk: no decoding, no dependencies.
*
*   node scripts/check-glb.mjs <file.glb>
*
* Prints the material names (variant keys) and moving parts; exits 1 with the problems found.
* Real size in meters: `npx @gltf-transform/cli inspect <file.glb>` (scene bboxMin / bboxMax).
*/
import { readFile } from 'node:fs/promises';

const MAX_BYTES = 30 * 1024 * 1024; // same limit as the server and inspectGlb
const MOVE_PREFIX = 'move_';
const validSlide = (slide) => Array.isArray(slide) && slide.length === 3 && slide.every(Number.isFinite);

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/check-glb.mjs <file.glb>');
const buf = await readFile(file);
const problems = [];
if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file} is not a binary glTF (GLB)`);
if (buf.length > MAX_BYTES) problems.push(`too large: ${(buf.length / 1048576).toFixed(1)} MB (max 30)`);
const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));

const meshNodes = (json.nodes ?? []).filter((node) => node.mesh !== undefined);
const movers = meshNodes.filter((node) => node.name?.startsWith(MOVE_PREFIX));
const bodies = meshNodes.length - movers.length;
if (bodies !== 1) problems.push(`${bodies} body mesh nodes (exactly 1 needed: join the parts, moving parts named move_...)`);
for (const node of movers) if (!validSlide(node.extras?.slide)) problems.push(`${node.name} has no valid "slide" (3 numbers, export with Custom Properties)`);
if (!(json.textures?.length > 0)) problems.push('no texture (at least one needed)');
const used = json.extensionsUsed ?? [];
if (!used.includes('KHR_draco_mesh_compression')) problems.push('not Draco compressed');
if ((json.images ?? []).some((image) => image.mimeType !== 'image/webp')) problems.push('textures not all WebP');
const unnamed = (json.materials ?? []).filter((m) => !m.name).length;
if (unnamed) problems.push(`${unnamed} material(s) without a name: they cannot have variants`);
const maxSide = Math.max(0, ...(json.images ?? []).map((image) => json.bufferViews?.[image.bufferView]?.byteLength ?? 0));

console.log('file      ', file, `${(buf.length / 1048576).toFixed(2)} MB`);
console.log('materials ', (json.materials ?? []).map((m) => m.name ?? '(unnamed)').join(', '));
console.log('textures  ', json.textures?.length ?? 0, `(largest ${(maxSide / 1024).toFixed(0)} KB)`);
console.log('parts     ', movers.map((node) => `${node.name} slide=${JSON.stringify(node.extras?.slide)}`).join(', ') || 'none');
if (problems.length) {
    console.log('PROBLEMS\n - ' + problems.join('\n - '));
    process.exit(1);
}
console.log('ok');
