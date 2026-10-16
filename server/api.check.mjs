/*
* End-to-end check of the "My environments" API, room access and the material library API
* (server/src/index.js, server/src/materials.js).
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

// Material library (materials.js, local R2 simulated by wrangler dev)
const M = `http://${H}/api/materials`;
const png = new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (ch) => ch.charCodeAt(0))], { type: 'image/png' });
const form = (fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
const ownerOnly = { Authorization: auth.Authorization };
assert.equal((await fetch(M, { method: 'POST', body: form({ name: 'x', category: 'wall', tileSize: '1', color: png }) })).status, 401);
assert.equal((await fetch(M, { method: 'POST', headers: ownerOnly, body: form({ name: 'x', category: 'roof', tileSize: '1', color: png }) })).status, 400);
assert.equal((await fetch(M, { method: 'POST', headers: ownerOnly, body: form({ name: 'x', category: 'wall', tileSize: '1' }) })).status, 400);
const mat = await (await fetch(M, { method: 'POST', headers: ownerOnly, body: form({ name: ' Test ', category: 'wall', tileSize: '1.5', color: png }) })).json();
assert.equal(mat.name, 'Test'); assert.equal(mat.tileSize, 1.5); assert.ok(mat.maps.color && !mat.maps.normal);
assert.ok((await (await fetch(M)).json()).some((m) => m.id === mat.id)); // public list
const served = await fetch(`http://${H}/files/${mat.maps.color}`);
assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'image/png');
// edit (PATCH, owner only): fields only, maps untouched; bad values refused
const patch = (body, headers = { ...ownerOnly, 'Content-Type': 'application/json' }) => fetch(`${M}/${mat.id}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
assert.equal((await patch({ kind: 'wood' }, { 'Content-Type': 'application/json' })).status, 401);
assert.equal((await patch({ category: 'roof' })).status, 400);
assert.equal((await patch({ kind: 'Wood!' })).status, 400);
assert.equal((await patch({ url: 'javascript:alert(1)' })).status, 400);
assert.equal((await patch({ price: -1 })).status, 400);
const card = await (await patch({ price: 45.5, vatRate: 22, waste: 10, code: 'AB-1', url: 'https://example.com/oak' })).json();
assert.equal(card.price, 45.5); assert.equal(card.url, 'https://example.com/oak');
assert.equal((await (await patch({ price: null })).json()).price, null);
const edited = await (await patch({ kind: 'wood', tileSize: 2 })).json();
assert.equal(edited.kind, 'wood'); assert.equal(edited.tileSize, 2); assert.equal(edited.name, 'Test'); assert.deepEqual(edited.maps, mat.maps);
assert.equal((await fetch(`${M}/${mat.id}`, { method: 'DELETE', headers: ownerOnly })).status, 204);
assert.ok(!(await (await fetch(M)).json()).some((m) => m.id === mat.id));
assert.equal((await fetch(`http://${H}/files/${mat.maps.color}`)).status, 404);
console.log('OK');
process.exit(0);
