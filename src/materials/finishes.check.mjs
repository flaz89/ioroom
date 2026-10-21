// Check for finishes.js: node src/materials/finishes.check.mjs
import assert from 'node:assert/strict';
import { ANTHRACITE_ID, FINISHES, STEEL_ID, WHITE_ID, finishMaterial, paintId } from './finishes.js';

assert.equal(paintId('#AABBCC'), 'paint:#aabbcc');
assert.deepEqual(finishMaterial(paintId('#123456')).finish.color, '#123456', 'any paint color');
assert.equal(finishMaterial(WHITE_ID).name, 'White');
assert.equal(finishMaterial(ANTHRACITE_ID).name, 'Anthracite');
assert.equal(finishMaterial(STEEL_ID).finish.metalness > 0, true);
assert.equal(finishMaterial('paint:red'), null, 'not a hex color');
assert.equal(finishMaterial('finish:gold'), null, 'unknown fixed finish');
assert.equal(finishMaterial('oak'), null, 'a library material');
assert.equal(finishMaterial(undefined), null);
assert.equal(finishMaterial(paintId('#123456')), finishMaterial(paintId('#123456')), 'the same record (stable for store selectors)');
assert.ok(FINISHES.every((f) => f.maps === null && f.category === 'fixture'));
console.log('finishes: ok');
