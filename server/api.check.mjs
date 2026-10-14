/*
* End-to-end check of the "My environments" API and room access (server/src/index.js).
* Needs a local server with a known token:
*   echo "ADMIN_TOKEN=test" > server/.dev.vars && npm --prefix server run dev
* then: node server/api.check.mjs   (env SYNC_HOST / ADMIN_TOKEN override localhost:8787 / "test")
* Prints OK, or throws on the first failed assertion.
*/
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import assert from 'node:assert/strict';
const H = process.env.SYNC_HOST ?? 'localhost:8787', B = `http://${H}/api/rooms`;
const auth = { Authorization: `Bearer ${process.env.ADMIN_TOKEN ?? 'test'}`, 'Content-Type': 'application/json' };
const api = (p, m = 'GET', body) => fetch(B + p, { method: m, headers: auth, body: body && JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Opens a room and returns { doc, provider, closeCode }
function open(id) {
  const doc = new Y.Doc(); const res = { doc, closeCode: null };
  res.provider = new YProvider(H, id, doc, { party: 'rooms' });
  res.provider.on('connection-close', (e) => { res.closeCode ??= e?.code; });
  return res;
}
assert.equal((await fetch(B)).status, 401);
const a = await (await api('', 'POST', { name: '  Soggiorno  ' })).json();
assert.equal(a.name, 'Soggiorno');
const c1 = open(a.id); await sleep(1500);
c1.doc.getMap('objects').set('o1', { id: 'o1', type: 'box' }); await sleep(3500); // > debounce
c1.provider.destroy();
const r = await (await api('/' + a.id, 'PATCH', { name: 'Living' })).json();
assert.equal(r.name, 'Living');
const d = await (await api('/' + a.id + '/duplicate', 'POST')).json();
assert.equal(d.name, 'Living (copy)');
const c2 = open(d.id); await sleep(1500);
assert.deepEqual(c2.doc.getMap('objects').get('o1'), { id: 'o1', type: 'box' });
const list = await (await api('')).json();
const ids = list.map((x) => x.id);
assert.ok(ids.includes(a.id) && ids.includes(d.id));
assert.equal(ids[0], d.id); // most recently edited first
assert.equal((await api('/' + d.id, 'DELETE')).status, 204);
await sleep(1000);
assert.equal(c2.closeCode, 4004);
c2.provider.destroy();
const c3 = open(d.id); await sleep(1500); assert.equal(c3.closeCode, 4004); c3.provider.destroy();
const c4 = open('never-created'); await sleep(1500); assert.equal(c4.closeCode, 4004); c4.provider.destroy();
assert.equal((await api('/' + d.id, 'PATCH', { name: 'x' })).status, 404);
const after = (await (await api('')).json()).map((x) => x.id);
assert.ok(after.includes(a.id) && !after.includes(d.id));
assert.equal((await api('/' + a.id, 'DELETE')).status, 204); // clean up
console.log('OK');
process.exit(0);
