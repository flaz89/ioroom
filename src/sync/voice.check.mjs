// node src/sync/voice.check.mjs
import assert from 'node:assert/strict';
import { voicePeerIds } from './voice.js';

const states = new Map([
    [1, { voice: { on: true, mic: false } }],
    [2, { voice: { on: true, mic: true } }],
    [3, { voice: null }],
    [4, {}],
    [5, { voice: { on: true, mic: false } }]
]);
assert.deepEqual(voicePeerIds(states, 2, true), [1, 5], 'everyone else in the voice');
assert.deepEqual(voicePeerIds(states, 2, false), [], 'nobody while this device is out of the voice');
assert.deepEqual(voicePeerIds(new Map(), 1, true), []);
console.log('ok');
