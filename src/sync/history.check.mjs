// Self-check of the undo history (history.js): node src/sync/history.check.mjs
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { LOCAL, SEED, startHistory, undo, redo } from './history.js';

const doc = new Y.Doc();
const objects = doc.getMap('objects');
const sun = doc.getMap('sun');
const remote = Symbol('remote');
const stop = startHistory(doc);

// seeding (SEED) and other people's edits are never undone
doc.transact(() => objects.set('chair', { x: 0 }), SEED);
doc.transact(() => objects.set('table', { x: 0 }), remote);

// own edits are undone and redone
doc.transact(() => objects.set('chair', { x: 1 }), LOCAL);
undo();
assert.deepEqual(objects.get('chair'), { x: 0 });
assert.ok(objects.has('table'));
redo();
assert.deepEqual(objects.get('chair'), { x: 1 });

// an undone creation is a deletion
await new Promise((resolve) => setTimeout(resolve, 350)); // past the capture timeout: a new step
doc.transact(() => objects.set('lamp', { x: 2 }), LOCAL);
undo();
assert.equal(objects.has('lamp'), false);
assert.deepEqual(objects.get('chair'), { x: 1 }); // the previous step is still there

// the sun is never in the history
doc.transact(() => sun.set('minutes', 600), LOCAL);
undo();
assert.equal(sun.get('minutes'), 600);

stop();
undo(); // no history: nothing happens, no error
console.log('history.check: ok');
