// Check for wrapLines (useCanvasTexture.js): node src/components/scene/xr-ui/wrapLines.check.mjs
// A fake ctx measures 1 unit per character, so widths are character counts.
import assert from 'node:assert/strict';
import { wrapLines } from './useCanvasTexture.js';

const ctx = { measureText: (text) => ({ width: text.length }) };
assert.deepEqual(wrapLines(ctx, 'hello big world', 9, 5), ['hello big', 'world']);
assert.deepEqual(wrapLines(ctx, 'a\nb', 9, 5), ['a', 'b']);
assert.deepEqual(wrapLines(ctx, 'abcdefghijkl', 5, 5), ['abcde', 'fghij', 'kl']);
assert.deepEqual(wrapLines(ctx, 'one two three four', 3, 2), ['one', 'tw…']);
console.log('wrapLines: ok');
