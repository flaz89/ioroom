// Self-check for boardZoom.js. Run: node src/components/scene/controls/boardZoom.check.mjs
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { zoomAboutMidpoint } from './boardZoom.js';

const start = { distance: 0.2, scale: 0.1, midpoint: new Vector3(0, 1, -0.5), position: new Vector3(0, 0.9, -0.6) };
const out = new Vector3();

// Hands twice as far apart, same midpoint: scale doubles, board point under the hands stays put
let scale = zoomAboutMidpoint(start, 0.4, start.midpoint, 0.01, 1, out);
assert.equal(scale, 0.2);
assert.ok(out.distanceTo(new Vector3(0, 0.8, -0.7)) < 1e-9, 'scaled around the midpoint');

// Clamped to the max scale
scale = zoomAboutMidpoint(start, 10, start.midpoint, 0.01, 0.3, out);
assert.equal(scale, 0.3);

// Same distance, midpoint moved 10 cm right: pure pan
scale = zoomAboutMidpoint(start, 0.2, new Vector3(0.1, 1, -0.5), 0.01, 1, out);
assert.equal(scale, 0.1);
assert.ok(out.distanceTo(new Vector3(0.1, 0.9, -0.6)) < 1e-9, 'follows the midpoint');

console.log('boardZoom: ok');
