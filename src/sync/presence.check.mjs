// Run: node src/sync/presence.check.mjs — lock rules of presence.js with a fake Yjs awareness
import assert from 'node:assert/strict';
import { bindAwareness, holdObject, isLockedByOther, releaseObject, getRoomUsers, deviceIdentity, staleClients, setAwaySource, onAwayChange } from './presence.js';

// Minimal awareness: this client + other clients' states, 'change' fired on every local update
function fakeAwareness(clientID) {
    const states = new Map([[clientID, {}]]);
    const handlers = new Map([['change', new Set()], ['update', new Set()]]);
    const fire = (changed = [clientID]) => {
        handlers.get('change').forEach((handler) => handler());
        handlers.get('update').forEach((handler) => handler({ added: [], updated: changed, removed: [] }));
    };
    return {
        clientID,
        getStates: () => states,
        getLocalState: () => states.get(clientID),
        setLocalStateField: (key, value) => { states.set(clientID, { ...states.get(clientID), [key]: value }); fire(); },
        on: (event, handler) => handlers.get(event).add(handler),
        off: (event, handler) => handlers.get(event).delete(handler),
        setRemote: (id, state) => { states.set(id, state); fire([id]); }
    };
}

const awareness = fakeAwareness(5);
const unbind = bindAwareness(awareness);

assert.equal(isLockedByOther('a'), false, 'free object');
awareness.setRemote(9, { holding: 'a', user: { color: '#f00' } });
assert.equal(isLockedByOther('a'), true, 'held by another device');
holdObject('a');
assert.equal(isLockedByOther('a'), false, 'simultaneous grab: lower client id (5 < 9) wins here');
awareness.setRemote(2, { holding: 'a' });
assert.equal(isLockedByOther('a'), true, 'simultaneous grab: client 2 beats 5');
releaseObject('a');
awareness.setRemote(2, {});
awareness.setRemote(9, {});
assert.equal(isLockedByOther('a'), false, 'released everywhere');
// users: one entry per DEVICE (two tabs of the same browser share its id), this device first, own color
awareness.setRemote(20, { user: { id: 'quest', name: 'Quest 2', color: '#e57373' } });
awareness.setRemote(21, { user: { id: 'quest', name: 'Quest 2', color: '#e57373' } });
awareness.setRemote(22, { user: { name: 'old client' } }); // no device id (older version): its own entry
const users = getRoomUsers();
assert.equal(users.length, 3, 'self + one Quest + the old client');
assert.ok(users[0].isSelf && users[0].color === deviceIdentity().color, 'self first, with the saved device color');
assert.equal(deviceIdentity(), deviceIdentity(), 'identity created once');
unbind();
assert.equal(isLockedByOther('a'), false, 'no room: never locked');
// timeout: self never stale; unknown clients start counting now; silent for > 75 s = stale
const heard = new Map([[7, 0], [8, 70000]]);
assert.deepEqual(staleClients([5, 7, 8, 9], 5, heard, 80000), [7]);
assert.ok(heard.has(9), 'a client known before binding starts counting now');
// away: announced once when the first source goes away and once when the last one comes back
const changes = [];
const stop = onAwayChange((isAway) => changes.push(isAway));
setAwaySource('page', true);
setAwaySource('xr', true);      // already away: no new announcement
setAwaySource('page', false);   // still away (xr)
setAwaySource('xr', false);
stop();
assert.deepEqual(changes, [true, false]);
console.log('presence: ok');
