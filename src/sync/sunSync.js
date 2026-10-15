import { useStore } from '../store/appStore';
import { bindFieldMap } from './fieldMapSync';

/*
* Sun settings shared by everyone in the room (store `sun`, see store/slices/sunSlice.js): the environment
* keeps its location, orientation, day and time. Called by connectRoom (roomSync.js); returns the unbind function.
*
* Model: a Y.Map "sun" with one key per field (cityId, northDeg, day, minutes): see fieldMapSync.js.
* Remote day/time changes also flash the sun arc, so everyone sees the sun move.
* ACCESS: only the owner changes location and north (UI rule in SunPanel.jsx).
* ponytail: enforced by the UI only; the server accepts any field from anyone. Validate on the server
* (per-field write rules) when guests are not trusted.
*/
export function bindSun(doc, provider) {
    return bindFieldMap(doc, provider, {
        name: 'sun',
        read: (state) => state.sun,
        write: (patch) => useStore.getState().setSun(patch),
        onRemote: (keysChanged) => {
            if (keysChanged.has('day') || keysChanged.has('minutes')) useStore.getState().showSunArc();
        }
    });
}
