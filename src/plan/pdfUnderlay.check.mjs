// Check for pdfUnderlay.js: node src/plan/pdfUnderlay.check.mjs
// A tiny PDF written by hand (one page, 200 x 100 pt) read by pdf.js (legacy build: runs in Node).
import assert from 'node:assert/strict';
import { pdfVectors } from './pdfUnderlay.js';

// pdf.js wants these canvas classes at load (from @napi-rs/canvas when installed): reading paths never uses them
for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) globalThis[name] ??= class {};
const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');

const content = [
    // a 100 x 50 pt rectangle on layer A-WALL (optional content), from (50, 25)
    '/OC /L1 BDC', '2 w', '50 25 m 150 25 l 150 75 l 50 75 l h S', 'EMC',
    // a clipping path (not drawn), then a line scaled x2 by cm: (0, 0) -> (10, 0) becomes 20 pt long
    'q', '0 0 200 100 re W n', '2 0 0 2 0 0 cm', '0.5 w', '0 0 m 10 0 l S', 'Q',
    // a filled triangle
    '10 10 m 20 10 l 15 20 l f'
].join('\n');
const objects = [
    '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R] /D << /ON [5 0 R] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Properties << /L1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /OCG /Name (A-WALL) >>'
];
let pdf = '%PDF-1.7\n';
const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
});
const xref = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

const doc = await getDocument({ data: new TextEncoder().encode(pdf), verbosity: 0 }).promise;
const page = await doc.getPage(1);
const config = await doc.getOptionalContentConfig();
const vectors = pdfVectors(await page.getOperatorList(), OPS, page.getViewport({ scale: 1 }).transform, (id) => config.getGroup(id)?.name);

const byName = Object.fromEntries(vectors.layers.map((layer) => [layer.name, layer.segments]));
assert.deepEqual(Object.keys(byName).sort(), ['A-WALL', 'Fills', 'Lines 1.00 pt']);
assert.equal(byName['A-WALL'].length, 4 * 4, 'closed rectangle = 4 segments (clip path not drawn)');
const [x1, z1, x2, z2] = byName['Lines 1.00 pt'];
assert.equal(Math.hypot(x2 - x1, z2 - z1), 20, 'cm scale applied (and line width 0.5 x 2)');
assert.equal(byName.Fills.length, 3 * 4);
// plan axes like a DXF: the rectangle spans 50 pt in z
const zs = byName['A-WALL'].filter((_, i) => i % 2 === 1);
assert.equal(Math.max(...zs) - Math.min(...zs), 50);
await doc.destroy();
console.log('pdfUnderlay ok');
