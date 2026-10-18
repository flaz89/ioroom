/*
* Local check of the automatic walls on a real drawing, without uploading anything to R2:
*   node scripts/dxf-walls-preview.mjs test/plan.dxf [WALL_LAYER] [units]
* Parses the DXF as the app does (plan/dxfUnderlay.js), runs plan/dxfWalls.js on the walls layer (default: the
* first named like walls) with every layer as context, prints a summary and writes <file>.walls.svg next to it:
* the drawing in orange, walls green, doors blue, windows violet (the same colors as the 2D plan preview).
* units: override the file's units (mm, cm, m, in, ft, or meters per drawing unit, e.g. 0.05) when the drawing
*   declares the wrong ones (as the app's calibration does).
*/
import { readFileSync, writeFileSync } from 'node:fs';
import DxfParser from 'dxf-parser';
import { UNIT_METERS, dxfVectors } from '../src/plan/dxfUnderlay.js';
import { detectedWallShapes, placeDetectedWalls, wallCandidates } from '../src/plan/dxfWalls.js';

const [file, layerArg, unitsArg] = process.argv.slice(2);
if (!file) throw new Error('usage: node scripts/dxf-walls-preview.mjs <file.dxf> [WALL_LAYER] [units]');

const vectors = dxfVectors(new DxfParser().parseSync(readFileSync(file, 'utf8')));
const units = unitsArg ?? vectors.units;
const layer = layerArg ?? vectors.layers.find(({ name }) => /wall|mur|paret/i.test(name))?.name ?? vectors.layers[0].name;
const segments = vectors.layers.find(({ name }) => name === layer)?.segments ?? [];
const unitMeters = UNIT_METERS[units] ?? Number(units);
const walls = wallCandidates(segments, unitMeters, { context: vectors.layers });

console.log(`units ${units} (file: ${vectors.units}), size ${vectors.width.toFixed(0)} x ${vectors.height.toFixed(0)}`);
console.log(`layers: ${vectors.layers.map(({ name, segments: s }) => `${name} (${s.length / 4})`).join(', ')}`);
const count = (kind) => walls.reduce((sum, wall) => sum + wall.openings.filter((o) => o.kind === kind).length, 0);
console.log(`${layer}: ${walls.length} walls, ${count('door')} doors, ${count('window')} windows`);

// SVG in drawing units (centered drawing: viewBox around the bulk), strokes in screen pixels
const half = Math.max(vectors.width, vectors.height) * 0.55;
const lines = vectors.layers.map(({ segments: s }) => {
    let d = '';
    for (let i = 0; i < s.length; i += 4) d += `M${s[i]} ${s[i + 1]}L${s[i + 2]} ${s[i + 3]}`;
    return `<path d="${d}" />`;
}).join('');
// the walls as the plan model will build them, in drawing units (identity placement)
const planWalls = placeDetectedWalls(walls, { metersPerPixel: 1, rotation: 0, center: [0, 0] }, (index) => `w${index}`);
const shapes = detectedWallShapes(planWalls).map(({ wall, openings }, index) => {
    const w = planWalls[index];
    const label = `<text x="${(w.a[0] + w.b[0]) / 2}" y="${(w.a[1] + w.b[1]) / 2}">${index}</text>`;
    return `<polygon class="wall" points="${wall.join(' ')}" />`
        + openings.map((o) => `<polygon class="${o.type}" points="${o.points.join(' ')}" />`).join('') + label;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${2 * half} ${2 * half}" width="1600" height="1600">
<style>
svg { background: #0b1030; }
path { fill: none; stroke: #ff9a1a; stroke-width: 1; vector-effect: non-scaling-stroke; opacity: .6; }
polygon { stroke-width: 1; vector-effect: non-scaling-stroke; }
.wall { fill: rgba(80,220,120,.35); stroke: #50dc78; }
.door { fill: rgba(77,163,255,.6); stroke: #4da3ff; }
.window { fill: rgba(179,136,255,.6); stroke: #b388ff; }
text { fill: #fff; font: ${half / 60}px monospace; text-anchor: middle; }
</style>
<g>${lines}</g><g>${shapes}</g></svg>`;
const out = file.replace(/\.dxf$/i, '') + '.walls.svg';
writeFileSync(out, svg);
console.log(`written ${out}`);
